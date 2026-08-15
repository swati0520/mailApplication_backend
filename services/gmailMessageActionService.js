import validator from "validator";
import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
} from "../config/gmailOAuth.js";
import {
  findGmailMessageForUser,
  updateGmailMessageLabelsForUser,
} from "../models/GmailMessage.js";
import { getAuthenticatedGmailClient } from "./gmailClientService.js";

export class GmailMessageActionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "GmailMessageActionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const requireMessage = async (gmailMessageId, userId, findMessage) => {
  const message = await findMessage(gmailMessageId, userId);
  if (!message) {
    throw new GmailMessageActionError(
      "gmail_message_not_found",
      "Gmail message not found",
      404
    );
  }
  return message;
};

const verifyRemoteMessage = async (gmail, message, gmailConnectionId) => {
  if (String(message.gmail_connection_id) !== String(gmailConnectionId)) {
    throw new GmailMessageActionError(
      "gmail_message_mismatch",
      "Gmail message does not belong to the connected account",
      403
    );
  }
  try {
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id: message.gmail_message_id,
      format: "minimal",
    });
    if (
      data?.id !== message.gmail_message_id ||
      (message.gmail_thread_id && data.threadId !== message.gmail_thread_id)
    ) {
      throw new GmailMessageActionError(
        "gmail_message_mismatch",
        "Gmail message does not belong to the connected account",
        403
      );
    }
  } catch (error) {
    if (error instanceof GmailMessageActionError) throw error;
    if (error?.response?.status === 404 || error?.code === 404) {
      throw new GmailMessageActionError(
        "gmail_message_not_found",
        "Gmail message no longer exists in the connected account",
        404
      );
    }
    throw error;
  }
};

const normalizeHeader = (value, fallback = "") => {
  const normalized = String(value ?? fallback).replace(/[\r\n]+/g, " ").trim();
  return normalized || fallback;
};

const encodeHeader = (value) => {
  const normalized = normalizeHeader(value);
  if (/^[\x20-\x7E]*$/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
};

const encodeBody = (body) => {
  const encoded = Buffer.from(String(body), "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
};

const buildRawMessage = ({ to, cc = [], subject, body, inReplyTo }) => {
  const headers = [
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    ...(inReplyTo
      ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${encodeBody(body)}`;
  return Buffer.from(mime, "utf8").toString("base64url");
};

const cleanReplyBody = (body) => {
  const lines = String(body).replace(/\r\n?/g, "\n").trim().split("\n");
  const quotedHeaderIndex = lines.findIndex((line) =>
    /^\s*On\s+.+\s+wrote:\s*$/i.test(line) ||
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
  );
  if (quotedHeaderIndex >= 0) {
    return lines.slice(0, quotedHeaderIndex).join("\n").trim();
  }

  const firstQuotedLine = lines.findIndex((line) => /^\s*>/.test(line));
  if (
    firstQuotedLine > 0 &&
    lines.slice(firstQuotedLine).every((line) => !line.trim() || /^\s*>/.test(line))
  ) {
    return lines.slice(0, firstQuotedLine).join("\n").trim();
  }
  return lines.join("\n").trim();
};

const runAfterSuccessfulSend = async (onSent, details) => {
  if (typeof onSent !== "function") return;
  try {
    await onSent(details);
  } catch {
    // Cache refresh is best-effort and must not turn a successful Gmail send into a failure.
  }
};

const deduplicateEmails = (emails, excludedEmail) => {
  const excluded = excludedEmail?.toLowerCase();
  const seen = new Set();
  return emails
    .map((email) => email?.trim().toLowerCase())
    .filter((email) => {
      if (!email || email === excluded || !validator.isEmail(email) || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    });
};

const getReplyRecipients = (message, gmailEmail, replyAll) => {
  const recipients = Array.isArray(message.recipients) ? message.recipients : [];
  const originalTo = recipients
    .filter(({ recipient_type: type }) => type === "to")
    .map(({ email }) => email);
  const originalCc = recipients
    .filter(({ recipient_type: type }) => type === "cc")
    .map(({ email }) => email);
  const sender = message.from_email;
  const primary = sender?.toLowerCase() === gmailEmail?.toLowerCase()
    ? originalTo
    : [sender];
  const to = deduplicateEmails(primary, gmailEmail);
  const cc = replyAll
    ? deduplicateEmails([...originalTo, ...originalCc], gmailEmail)
        .filter((email) => !to.includes(email))
    : [];

  if (!to.length) {
    throw new GmailMessageActionError(
      "gmail_reply_recipient_missing",
      "The original sender is not a valid reply recipient"
    );
  }
  return { to, cc };
};

const sendReply = async ({
  gmailMessageId,
  userId,
  body,
  replyAll,
  findMessage = findGmailMessageForUser,
  getGmailClient = getAuthenticatedGmailClient,
  onSent,
}) => {
  const cleanedBody = typeof body === "string" ? cleanReplyBody(body) : "";
  if (!cleanedBody) {
    throw new GmailMessageActionError(
      "gmail_reply_body_required",
      "Reply body is required"
    );
  }
  const message = await requireMessage(gmailMessageId, userId, findMessage);
  if (!message.gmail_thread_id || !message.rfc_message_id) {
    throw new GmailMessageActionError(
      "gmail_thread_headers_missing",
      "This Gmail message is missing the headers required for a threaded reply",
      409
    );
  }
  const { gmail, gmailConnectionId, gmailEmail } = await getGmailClient({
    userId,
    requiredScopes: [GMAIL_SEND_SCOPE],
  });
  await verifyRemoteMessage(gmail, message, gmailConnectionId);
  const { to, cc } = getReplyRecipients(message, gmailEmail, replyAll);
  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      threadId: message.gmail_thread_id,
      raw: buildRawMessage({
        to,
        cc,
        subject: message.subject || "(No subject)",
        body: cleanedBody,
        inReplyTo: normalizeHeader(message.rfc_message_id),
      }),
    },
  });
  await runAfterSuccessfulSend(onSent, {
    senderUserId: userId,
    recipientEmails: [...to, ...cc],
  });
  return { gmailMessageId: data.id, gmailThreadId: data.threadId };
};

export const trashGmailMessage = async ({
  gmailMessageId,
  userId,
  findMessage = findGmailMessageForUser,
  getGmailClient = getAuthenticatedGmailClient,
  markTrashed = updateGmailMessageLabelsForUser,
}) => {
  const message = await requireMessage(gmailMessageId, userId, findMessage);
  const { gmail, gmailConnectionId } = await getGmailClient({
    userId,
    requiredScopes: [GMAIL_MODIFY_SCOPE],
  });
  await verifyRemoteMessage(gmail, message, gmailConnectionId);
  await gmail.users.messages.trash({ userId: "me", id: gmailMessageId });
  const currentLabels = Array.isArray(message.label_ids)
    ? message.label_ids
    : JSON.parse(message.label_ids || "[]");
  await markTrashed({
    gmailMessageId,
    userId,
    labelIds: [...new Set([...currentLabels.filter((label) => label !== "INBOX"), "TRASH"])],
  });
};

const parseLabels = (labelIds) => {
  if (Array.isArray(labelIds)) return labelIds;
  try {
    const parsed = JSON.parse(labelIds || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const modifyGmailMessageLabels = async ({
  gmailMessageId,
  userId,
  addLabelIds = [],
  removeLabelIds = [],
  findMessage = findGmailMessageForUser,
  getGmailClient = getAuthenticatedGmailClient,
  updateLabels = updateGmailMessageLabelsForUser,
}) => {
  const message = await requireMessage(gmailMessageId, userId, findMessage);
  const { gmail, gmailConnectionId } = await getGmailClient({
    userId,
    requiredScopes: [GMAIL_MODIFY_SCOPE],
  });
  await verifyRemoteMessage(gmail, message, gmailConnectionId);

  const { data } = await gmail.users.messages.modify({
    userId: "me",
    id: gmailMessageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  const removedLabels = new Set(removeLabelIds);
  const calculatedLabels = [
    ...parseLabels(message.label_ids).filter((label) => !removedLabels.has(label)),
    ...addLabelIds,
  ];
  const labelIds = [...new Set(
    Array.isArray(data?.labelIds) ? data.labelIds : calculatedLabels
  )];

  await updateLabels({ gmailMessageId, userId, labelIds });
  return { gmailMessageId, labelIds };
};

export const archiveGmailMessage = (options) =>
  modifyGmailMessageLabels({
    ...options,
    removeLabelIds: ["INBOX", "SPAM"],
  });

export const unarchiveGmailMessage = (options) =>
  modifyGmailMessageLabels({ ...options, addLabelIds: ["INBOX"] });

export const markGmailMessageRead = (options) =>
  modifyGmailMessageLabels({ ...options, removeLabelIds: ["UNREAD"] });

export const markGmailMessageUnread = (options) =>
  modifyGmailMessageLabels({ ...options, addLabelIds: ["UNREAD"] });

export const starGmailMessage = (options) =>
  modifyGmailMessageLabels({ ...options, addLabelIds: ["STARRED"] });

export const unstarGmailMessage = (options) =>
  modifyGmailMessageLabels({ ...options, removeLabelIds: ["STARRED"] });

export const markGmailMessageImportant = (options) =>
  modifyGmailMessageLabels({ ...options, addLabelIds: ["IMPORTANT"] });

export const markGmailMessageUnimportant = (options) =>
  modifyGmailMessageLabels({ ...options, removeLabelIds: ["IMPORTANT"] });

export const markGmailMessageSpam = (options) =>
  modifyGmailMessageLabels({
    ...options,
    addLabelIds: ["SPAM"],
    removeLabelIds: ["INBOX"],
  });

export const markGmailMessageNotSpam = (options) =>
  modifyGmailMessageLabels({
    ...options,
    addLabelIds: ["INBOX"],
    removeLabelIds: ["SPAM"],
  });

export const replyToGmailMessage = (options) =>
  sendReply({ ...options, replyAll: false });

export const replyAllToGmailMessage = (options) =>
  sendReply({ ...options, replyAll: true });

export const forwardGmailMessage = async ({
  gmailMessageId,
  userId,
  to,
  body = "",
  findMessage = findGmailMessageForUser,
  getGmailClient = getAuthenticatedGmailClient,
  onSent,
}) => {
  const destination = typeof to === "string" ? to.trim().toLowerCase() : "";
  if (!validator.isEmail(destination)) {
    throw new GmailMessageActionError(
      "gmail_forward_recipient_invalid",
      "A valid forwarding email address is required"
    );
  }
  const message = await requireMessage(gmailMessageId, userId, findMessage);
  const { gmail, gmailConnectionId } = await getGmailClient({
    userId,
    requiredScopes: [GMAIL_SEND_SCOPE],
  });
  await verifyRemoteMessage(gmail, message, gmailConnectionId);
  const originalRecipients = (message.recipients || [])
    .filter(({ recipient_type: type }) => type === "to")
    .map(({ email }) => email)
    .join(", ");
  const forwardedBody = [
    body.trim(),
    "---------- Forwarded message ----------",
    `From: ${normalizeHeader(message.from_email, "Unknown sender")}`,
    `Date: ${new Date(message.internal_date).toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
    `Subject: ${normalizeHeader(message.subject, "(No subject)")}`,
    `To: ${normalizeHeader(originalRecipients, "Undisclosed recipients")}`,
    "",
    message.body_text || message.snippet || "",
  ].filter((part, index) => index !== 0 || part).join("\r\n");
  const subject = /^fwd:/i.test(message.subject || "")
    ? message.subject
    : `Fwd: ${message.subject || "(No subject)"}`;
  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRawMessage({ to: [destination], subject, body: forwardedBody }),
    },
  });
  await runAfterSuccessfulSend(onSent, {
    senderUserId: userId,
    recipientEmails: [destination],
  });
  return { gmailMessageId: data.id, gmailThreadId: data.threadId };
};
