import path from "node:path";
import { GMAIL_READONLY_SCOPE } from "../config/gmailOAuth.js";
import { findGmailAttachmentForUser } from "../models/GmailMessage.js";
import {
  getAuthenticatedGmailClient,
  GmailConnectionError,
} from "./gmailClientService.js";

const GMAIL_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const GMAIL_ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

export class GmailAttachmentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "GmailAttachmentError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const requireGmailId = (value, type) => {
  const pattern = type === "message"
    ? GMAIL_MESSAGE_ID_PATTERN
    : GMAIL_ATTACHMENT_ID_PATTERN;
  if (!pattern.test(value || "")) {
    throw new GmailAttachmentError(
      `gmail_${type}_id_invalid`,
      `Invalid Gmail ${type} ID`
    );
  }
  return value;
};

const normalizeMimeType = (value) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream";
};

const normalizeFilename = (value) => {
  const portable = String(value || "attachment").replace(/\\/g, "/");
  return path.basename(portable).replace(/[\u0000-\u001F\u007F]/g, "").trim() ||
    "attachment";
};

export const buildInlineContentDisposition = (filename) => {
  const normalized = normalizeFilename(filename);
  const fallback = normalized
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(normalized)
    .replace(/['()]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const decodeAttachmentData = (value) => {
  if (typeof value !== "string") {
    throw new GmailAttachmentError(
      "gmail_attachment_data_missing",
      "Gmail did not return attachment content",
      502
    );
  }
  const unpadded = value.replace(/=+$/g, "");
  if (!/^[A-Za-z0-9_-]*$/.test(unpadded) || unpadded.length % 4 === 1) {
    throw new GmailAttachmentError(
      "gmail_attachment_data_invalid",
      "Gmail returned invalid attachment content",
      502
    );
  }
  return Buffer.from(unpadded, "base64url");
};

const getResponseStatus = (error) =>
  Number(error?.response?.status || error?.status || 0);

const getGmailErrorMessage = (error) =>
  error?.response?.data?.error?.message || error?.message || "";

const getGmailErrorReasons = (error) =>
  error?.response?.data?.error?.errors
    ?.map(({ reason }) => reason)
    .filter(Boolean) || [];

const isInvalidAttachmentToken = (error) =>
  getResponseStatus(error) === 400 &&
  (
    /invalid attachment token/i.test(getGmailErrorMessage(error)) ||
    getGmailErrorReasons(error).includes("invalidArgument")
  );

const throwMappedGmailError = (error, missingResource) => {
  if (
    error instanceof GmailAttachmentError ||
    error instanceof GmailConnectionError
  ) {
    throw error;
  }

  const status = getResponseStatus(error);
  if (status === 404) {
    throw new GmailAttachmentError(
      missingResource === "message"
        ? "gmail_message_not_found"
        : "gmail_attachment_not_found",
      missingResource === "message"
        ? "Gmail message no longer exists"
        : "Gmail attachment no longer exists",
      404
    );
  }
  if (status === 401 || status === 403) {
    throw new GmailConnectionError(
      "gmail_authorization_failed",
      "Reconnect Gmail to authorize attachment access"
    );
  }
  throw new GmailAttachmentError(
    "gmail_attachment_fetch_failed",
    "Gmail attachment could not be retrieved",
    502
  );
};

const findMimePart = (part, mimePartId) => {
  if (!part) return null;
  if (String(part.partId ?? "") === String(mimePartId)) return part;
  for (const child of part.parts || []) {
    const match = findMimePart(child, mimePartId);
    if (match) return match;
  }
  return null;
};

const fetchCurrentAttachmentData = async ({
  gmail,
  gmailMessageId,
  mimePartId,
}) => {
  let message;
  try {
    ({ data: message } = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "FULL",
    }));
  } catch (error) {
    throwMappedGmailError(error, "message");
  }

  const part = findMimePart(message?.payload, mimePartId);
  if (!part) {
    throw new GmailAttachmentError(
      "gmail_attachment_not_found",
      "Gmail attachment no longer exists",
      404
    );
  }
  if (typeof part.body?.data === "string") return part.body.data;
  if (!part.body?.attachmentId) {
    throw new GmailAttachmentError(
      "gmail_attachment_not_found",
      "Gmail attachment content is unavailable",
      404
    );
  }

  try {
    const { data } = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: gmailMessageId,
      id: part.body.attachmentId,
    });
    return data?.data;
  } catch (error) {
    throwMappedGmailError(error, "attachment");
  }
};

export const getGmailAttachmentContent = async ({
  gmailMessageId,
  gmailAttachmentId,
  userId,
  findAttachment = findGmailAttachmentForUser,
  getGmailClient = getAuthenticatedGmailClient,
}) => {
  requireGmailId(gmailMessageId, "message");
  requireGmailId(gmailAttachmentId, "attachment");

  const ownership = await findAttachment({
    gmailMessageId,
    gmailAttachmentId,
    userId,
  });
  if (ownership.status === "message_not_found") {
    throw new GmailAttachmentError(
      "gmail_message_not_found",
      "Gmail message not found",
      404
    );
  }
  if (ownership.status !== "allowed") {
    throw new GmailAttachmentError(
      "gmail_attachment_not_found",
      "Gmail attachment not found",
      404
    );
  }

  const { gmail, gmailConnectionId } = await getGmailClient({
    userId,
    requiredScopes: [GMAIL_READONLY_SCOPE],
  });
  if (
    String(ownership.attachment.gmail_connection_id) !==
    String(gmailConnectionId)
  ) {
    throw new GmailAttachmentError(
      "gmail_attachment_mismatch",
      "Gmail attachment does not belong to the connected account",
      403
    );
  }

  let encodedData;
  try {
    const { data } = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: gmailMessageId,
      id: gmailAttachmentId,
    });
    encodedData = data?.data;
  } catch (error) {
    if (isInvalidAttachmentToken(error)) {
      encodedData = await fetchCurrentAttachmentData({
        gmail,
        gmailMessageId,
        mimePartId: ownership.attachment.mime_part_id,
      });
    } else {
      throwMappedGmailError(error, "attachment");
    }
  }

  return {
    buffer: decodeAttachmentData(encodedData),
    filename: normalizeFilename(ownership.attachment.filename),
    contentType: normalizeMimeType(ownership.attachment.mime_type),
  };
};
