import fs from "node:fs/promises";
import validator from "validator";
import {
  claimDraftForSend,
  createDraft as createDraftRecord,
  deleteDraft as deleteDraftRecord,
  finalizeDraftSend,
  findOwnedDraft,
  getDraftMails,
  updateDraft as updateDraftRecord,
  updateMailGmailDelivery,
} from "../models/Mail.js";
import {
  getAttachmentFilesForMail,
  getAttachments,
} from "../models/Attachment.js";
import { findUserByEmail, findUserById } from "../models/User.js";
import { removeAttachmentFile, resolveAttachmentPath } from "../utils/attachmentStorage.js";
import {
  GmailComposeDeliveryError,
  sendNewGmailMessage,
} from "./gmailComposeDeliveryService.js";
import { triggerImmediateGmailSync } from "./gmailImmediateSyncService.js";

export class DraftServiceError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = "DraftServiceError";
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const parseRecipientList = (value) => {
  if (Array.isArray(value)) return value.flatMap(parseRecipientList);
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") return [normalizeText(value)].filter(Boolean);

  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.flatMap(parseRecipientList);
  } catch {
    // Plain comma-separated compose input is supported.
  }
  return trimmed.split(",").map((email) => email.trim()).filter(Boolean);
};

const normalizeRecipientList = (value) =>
  [...new Set(parseRecipientList(value).map((email) => email.toLowerCase()))];

const serializeRecipientList = (value) => {
  const emails = normalizeRecipientList(value);
  return emails.length ? JSON.stringify(emails) : null;
};

const presentDraft = async (draft, getDraftAttachments = getAttachments) => ({
  ...draft,
  to: normalizeRecipientList(draft.to_email).join(", "),
  cc: normalizeRecipientList(draft.cc).join(", "),
  bcc: normalizeRecipientList(draft.bcc).join(", "),
  attachments: await getDraftAttachments(draft.id),
});

const requireUser = async (userId, findUser = findUserById) => {
  const user = await findUser(userId);
  if (!user) {
    throw new DraftServiceError("user_not_found", "User not found", 404);
  }
  return user;
};

const requireOwnedDraft = async (draftId, userId, findDraft = findOwnedDraft) => {
  const draft = await findDraft(draftId, userId);
  if (!draft) {
    throw new DraftServiceError("draft_not_found", "Draft not found", 404);
  }
  return draft;
};

export const createDraft = async ({
  userId,
  data = {},
  findUser = findUserById,
  createRecord = createDraftRecord,
  getDraftAttachments = getAttachments,
  findDraft = findOwnedDraft,
}) => {
  const user = await requireUser(userId, findUser);
  const result = await createRecord(
    user.id,
    null,
    user.email,
    normalizeRecipientList(data.to).join(", "),
    serializeRecipientList(data.cc),
    serializeRecipientList(data.bcc),
    normalizeText(data.subject),
    normalizeText(data.body)
  );
  const draft = await requireOwnedDraft(result.insertId, userId, findDraft);
  return presentDraft(draft, getDraftAttachments);
};

export const updateDraft = async ({
  draftId,
  userId,
  data = {},
  findDraft = findOwnedDraft,
  updateRecord = updateDraftRecord,
  getDraftAttachments = getAttachments,
}) => {
  const draft = await requireOwnedDraft(draftId, userId, findDraft);
  const result = await updateRecord(
    draft.id,
    userId,
    null,
    data.to !== undefined
      ? normalizeRecipientList(data.to).join(", ")
      : draft.to_email,
    data.cc !== undefined ? serializeRecipientList(data.cc) : draft.cc,
    data.bcc !== undefined ? serializeRecipientList(data.bcc) : draft.bcc,
    data.subject !== undefined ? normalizeText(data.subject) : draft.subject,
    data.body !== undefined ? normalizeText(data.body) : draft.body
  );
  if (result.affectedRows === 0) {
    const currentDraft = await findDraft(draft.id, userId);
    if (!currentDraft) {
      throw new DraftServiceError("draft_not_found", "Draft not found", 404);
    }
    if (currentDraft.gmail_delivery_status !== "pending") {
      return presentDraft(currentDraft, getDraftAttachments);
    }
    throw new DraftServiceError(
      "draft_send_in_progress",
      "Draft is currently being sent",
      409
    );
  }
  return presentDraft(
    await requireOwnedDraft(draft.id, userId, findDraft),
    getDraftAttachments
  );
};

export const getDrafts = async ({
  userId,
  limit,
  offset,
  listDrafts = getDraftMails,
  getDraftAttachments = getAttachments,
}) => {
  const { mails, totalMails } = await listDrafts(userId, limit, offset);
  return {
    drafts: await Promise.all(
      mails.map((draft) => presentDraft(draft, getDraftAttachments))
    ),
    totalDrafts: Number(totalMails) || 0,
  };
};

export const getDraftById = async ({
  draftId,
  userId,
  findDraft = findOwnedDraft,
  getDraftAttachments = getAttachments,
}) => presentDraft(
  await requireOwnedDraft(draftId, userId, findDraft),
  getDraftAttachments
);

export const deleteDraft = async ({
  draftId,
  userId,
  findDraft = findOwnedDraft,
  deleteRecord = deleteDraftRecord,
  removeStoredFile = removeAttachmentFile,
}) => {
  await requireOwnedDraft(draftId, userId, findDraft);
  const result = await deleteRecord(draftId, userId);
  if (result.affectedRows === 0) {
    const currentDraft = await findDraft(draftId, userId);
    if (currentDraft?.gmail_delivery_status === "pending") {
      throw new DraftServiceError(
        "draft_send_in_progress",
        "Draft is currently being sent",
        409
      );
    }
    throw new DraftServiceError("draft_not_found", "Draft not found", 404);
  }
  await Promise.allSettled(
    (result.attachmentPaths || []).map((filePath) => removeStoredFile(filePath))
  );
  return { draftId };
};

const resolveSendRecipients = async ({
  draft,
  user,
  findRecipient = findUserByEmail,
}) => {
  const groups = [
    ["to", normalizeRecipientList(draft.to_email)],
    ["cc", normalizeRecipientList(draft.cc)],
    ["bcc", normalizeRecipientList(draft.bcc)],
  ];
  if (!groups[0][1].length || !normalizeText(draft.subject) || !normalizeText(draft.body)) {
    throw new DraftServiceError(
      "draft_incomplete",
      "Draft requires a To recipient, subject, and body"
    );
  }

  const seen = new Set();
  const recipientInputs = [];
  for (const [recipientType, emails] of groups) {
    for (const email of emails) {
      if (!validator.isEmail(email)) {
        throw new DraftServiceError(
          "draft_recipient_invalid",
          `Draft contains an invalid recipient: ${email}`
        );
      }
      if (seen.has(email)) continue;
      seen.add(email);
      recipientInputs.push({ recipientType, email });
    }
  }
  if (recipientInputs.some(({ email }) => email === user.email.trim().toLowerCase())) {
    throw new DraftServiceError(
      "draft_self_send_not_supported",
      "Sending mail to yourself is not supported"
    );
  }

  const resolvedUsers = await Promise.all(
    recipientInputs.map(({ email }) => findRecipient(email))
  );
  const missingIndex = resolvedUsers.findIndex((recipient) => !recipient);
  if (missingIndex >= 0) {
    throw new DraftServiceError(
      "draft_recipient_not_found",
      `Recipient user not found: ${recipientInputs[missingIndex].email}`,
      404
    );
  }
  const recipients = recipientInputs.map((recipient, index) => ({
    ...recipient,
    userId: resolvedUsers[index].id,
  }));
  if (recipients.some(({ userId }) => String(userId) === String(user.id))) {
    throw new DraftServiceError(
      "draft_self_send_not_supported",
      "Sending mail to yourself is not supported"
    );
  }
  return recipients;
};

const loadGmailAttachments = async (
  draftId,
  getFiles = getAttachmentFilesForMail,
  readFile = fs.readFile
) => Promise.all((await getFiles(draftId)).map(async (attachment) => ({
  originalname: attachment.file_name,
  mimetype: attachment.file_type,
  size: attachment.file_size,
  buffer: await readFile(resolveAttachmentPath(attachment.file_path)),
})));

export const sendDraft = async ({
  draftId,
  userId,
  findUser = findUserById,
  findDraft = findOwnedDraft,
  findRecipient = findUserByEmail,
  claimDraft = claimDraftForSend,
  markDelivery = updateMailGmailDelivery,
  finalizeSend = finalizeDraftSend,
  sendGmail = sendNewGmailMessage,
  getAttachmentFiles = getAttachmentFilesForMail,
  readFile = fs.readFile,
  triggerSync = triggerImmediateGmailSync,
}) => {
  const user = await requireUser(userId, findUser);
  await requireOwnedDraft(draftId, userId, findDraft);
  const claim = await claimDraft(draftId, userId);
  if (claim.affectedRows === 0) {
    const currentDraft = await findDraft(draftId, userId);
    if (!currentDraft) {
      throw new DraftServiceError("draft_not_found", "Draft not found", 404);
    }
    throw new DraftServiceError(
      "draft_send_in_progress",
      "Draft is currently being sent",
      409
    );
  }

  const draft = await requireOwnedDraft(draftId, userId, findDraft);
  let recipients;
  let attachments;
  try {
    recipients = await resolveSendRecipients({ draft, user, findRecipient });
    attachments = await loadGmailAttachments(draftId, getAttachmentFiles, readFile);
  } catch (error) {
    await markDelivery({
      mailId: draftId,
      senderUserId: userId,
      deliveryStatus: "failed",
      errorCode: error.code || "draft_preparation_failed",
      errorMessage: error.message || "Draft could not be prepared for sending",
    });
    throw error;
  }

  const emailsByType = (type) => recipients
    .filter((recipient) => recipient.recipientType === type)
    .map((recipient) => recipient.email);
  let delivery;
  try {
    delivery = await sendGmail({
      userId,
      to: emailsByType("to"),
      cc: emailsByType("cc"),
      bcc: emailsByType("bcc"),
      subject: normalizeText(draft.subject),
      body: normalizeText(draft.body),
      attachments,
    });
  } catch (error) {
    if (error instanceof GmailComposeDeliveryError) {
      await markDelivery({
        mailId: draftId,
        senderUserId: userId,
        deliveryStatus: error.deliveryStatus,
        errorCode: error.code,
        errorMessage: error.message,
      });
    }
    throw error;
  }

  const primaryTo = recipients.find(({ recipientType }) => recipientType === "to");
  let finalized;
  try {
    finalized = await finalizeSend({
      mailId: draftId,
      userId,
      receiverId: primaryTo.userId,
      toEmail: primaryTo.email,
      cc: emailsByType("cc").length ? JSON.stringify(emailsByType("cc")) : null,
      bcc: emailsByType("bcc").length ? JSON.stringify(emailsByType("bcc")) : null,
      recipients,
      gmailDeliveryStatus: delivery.deliveryStatus,
      gmailMessageId: delivery.gmailMessageId ?? null,
      gmailThreadId: delivery.gmailThreadId ?? null,
    });
  } catch (error) {
    throw new DraftServiceError(
      "draft_send_finalize_failed",
      "Gmail accepted the draft, but local completion is pending; do not resend",
      500,
      { deliveryStatus: "pending", cause: error }
    );
  }
  if (finalized.status !== "sent") {
    throw new DraftServiceError(
      "draft_send_finalize_failed",
      "Gmail accepted the draft, but local completion is pending; do not resend",
      500,
      { deliveryStatus: "pending" }
    );
  }

  try {
    await triggerSync({
      senderUserId: userId,
      recipientEmails: recipients.map(({ email }) => email),
    });
  } catch {
    // Cache refresh is best-effort after a confirmed send.
  }
  return {
    draftId,
    mailId: draftId,
    deliveryStatus: delivery.deliveryStatus,
    gmailMessageId: delivery.gmailMessageId ?? null,
    gmailThreadId: delivery.gmailThreadId ?? null,
  };
};
