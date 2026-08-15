import crypto from "node:crypto";
import path from "node:path";

export const MAX_GMAIL_MIME_BYTES = 35 * 1024 * 1024;

export class GmailMimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GmailMimeError";
    this.code = code;
  }
}

const normalizeHeader = (value, fallback = "") => {
  const normalized = String(value ?? fallback).replace(/[\r\n]+/g, " ").trim();
  return normalized || fallback;
};

const encodeHeader = (value) => {
  const normalized = normalizeHeader(value);
  if (/^[\x20-\x7E]*$/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
};

const encodeBase64Lines = (value) => {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value), "utf8");
  const encoded = buffer.toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
};

const normalizeAddresses = (addresses) =>
  (Array.isArray(addresses) ? addresses : [])
    .map((address) => normalizeHeader(address))
    .filter(Boolean);

const normalizeMimeType = (mimeType) => {
  const normalized = normalizeHeader(mimeType).toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream";
};

const getAttachmentNameHeaders = (fileName) => {
  const portableName = String(fileName || "attachment").replace(/\\/g, "/");
  const normalized = normalizeHeader(path.basename(portableName), "attachment");
  const asciiFallback = normalized
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(normalized)
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return {
    contentTypeName: `name="${asciiFallback}"`,
    dispositionName: `filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
  };
};

const buildTextPart = (body) => [
  'Content-Type: text/plain; charset="UTF-8"',
  "Content-Transfer-Encoding: base64",
  "",
  encodeBase64Lines(body),
].join("\r\n");

const buildAttachmentPart = (attachment) => {
  if (!Buffer.isBuffer(attachment?.buffer)) {
    throw new GmailMimeError(
      "gmail_attachment_invalid",
      "A Gmail attachment is missing its uploaded content"
    );
  }

  const { contentTypeName, dispositionName } = getAttachmentNameHeaders(
    attachment.originalname
  );
  return [
    `Content-Type: ${normalizeMimeType(attachment.mimetype)}; ${contentTypeName}`,
    `Content-Disposition: attachment; ${dispositionName}`,
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Lines(attachment.buffer),
  ].join("\r\n");
};

export const buildGmailRawMessage = ({
  from,
  to,
  cc = [],
  bcc = [],
  subject,
  body,
  attachments = [],
}) => {
  const toAddresses = normalizeAddresses(to);
  const ccAddresses = normalizeAddresses(cc);
  const bccAddresses = normalizeAddresses(bcc);
  if (!toAddresses.length) {
    throw new GmailMimeError(
      "gmail_recipient_missing",
      "At least one Gmail recipient is required"
    );
  }

  const headers = [
    ...(from ? [`From: ${normalizeHeader(from)}`] : []),
    `To: ${toAddresses.join(", ")}`,
    ...(ccAddresses.length ? [`Cc: ${ccAddresses.join(", ")}`] : []),
    ...(bccAddresses.length ? [`Bcc: ${bccAddresses.join(", ")}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
  ];

  let mime;
  if (!attachments.length) {
    mime = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      encodeBase64Lines(body),
    ].join("\r\n");
  } else {
    const boundary = `----=_MailApplication_${crypto.randomBytes(18).toString("hex")}`;
    const parts = [
      buildTextPart(body),
      ...attachments.map(buildAttachmentPart),
    ];
    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts.flatMap((part) => [`--${boundary}`, part]),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  if (Buffer.byteLength(mime, "utf8") > MAX_GMAIL_MIME_BYTES) {
    throw new GmailMimeError(
      "gmail_message_too_large",
      "The composed message is too large for Gmail delivery"
    );
  }

  return Buffer.from(mime, "utf8").toString("base64url");
};
