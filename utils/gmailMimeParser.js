import sanitizeHtml from "sanitize-html";

const decodeBase64Url = (value) => {
  if (!value) return "";

  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
};

const sanitizeGmailHtml = (html) =>
  sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2",
      "h3", "h4", "hr", "i", "li", "ol", "p", "pre", "span", "strong",
      "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });

const splitAddresses = (value) => {
  const addresses = [];
  let current = "";
  let quoted = false;

  for (const character of value || "") {
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      addresses.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) addresses.push(current);
  return addresses;
};

export const parseEmailAddresses = (value) =>
  splitAddresses(value)
    .map((entry) => {
      const trimmed = entry.trim();
      const bracketMatch = trimmed.match(/^(.*?)<([^<>]+)>$/);
      const email = (bracketMatch?.[2] || trimmed).trim().toLowerCase();
      const displayName = bracketMatch?.[1]
        ?.trim()
        .replace(/^"|"$/g, "") || null;

      if (!email || !email.includes("@")) return null;
      return { email, displayName };
    })
    .filter(Boolean);

const collectParts = (part, result) => {
  if (!part) return;

  const mimeType = part.mimeType?.toLowerCase();
  const content = decodeBase64Url(part.body?.data);

  if (mimeType === "text/plain" && content) result.plainParts.push(content);
  if (mimeType === "text/html" && content) result.htmlParts.push(content);

  if (part.filename) {
    result.attachments.push({
      gmailAttachmentId: part.body?.attachmentId || null,
      mimePartId: part.partId || "root",
      filename: part.filename,
      mimeType: part.mimeType || null,
      size: Number(part.body?.size) || null,
    });
  }

  for (const child of part.parts || []) collectParts(child, result);
};

const getHeaders = (headers = []) => {
  const result = new Map();
  for (const header of headers) {
    const name = header?.name?.toLowerCase();
    if (!name) continue;
    result.set(name, result.has(name)
      ? `${result.get(name)}, ${header.value || ""}`
      : header.value || "");
  }
  return result;
};

export const parseGmailMessage = (message) => {
  if (!message?.id || !message.payload) {
    throw new Error("Invalid Gmail message payload");
  }

  const headers = getHeaders(message.payload.headers);
  const from = parseEmailAddresses(headers.get("from"))[0] || {};
  const parsedParts = { plainParts: [], htmlParts: [], attachments: [] };
  collectParts(message.payload, parsedParts);
  const sanitizedHtml = parsedParts.htmlParts.length
    ? sanitizeGmailHtml(parsedParts.htmlParts.join("\n"))
    : null;
  const bodyText = parsedParts.plainParts.join("\n").trim() ||
    (sanitizedHtml
      ? sanitizeHtml(sanitizedHtml, { allowedTags: [], allowedAttributes: {} })
      : "");
  const recipients = [];

  for (const [type, header] of [["to", "to"], ["cc", "cc"], ["bcc", "bcc"]]) {
    for (const address of parseEmailAddresses(headers.get(header))) {
      recipients.push({ recipientType: type, ...address });
    }
  }

  const internalDateNumber = Number(message.internalDate);
  const headerDate = new Date(headers.get("date") || 0);
  const internalDate = Number.isFinite(internalDateNumber) && internalDateNumber > 0
    ? new Date(internalDateNumber)
    : headerDate;

  if (Number.isNaN(internalDate.getTime())) {
    throw new Error("Gmail message has an invalid date");
  }

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId || null,
    rfcMessageId: headers.get("message-id") || null,
    historyId: message.historyId || null,
    internalDate,
    fromEmail: from.email || null,
    fromName: from.displayName || null,
    subject: headers.get("subject") || "",
    snippet: message.snippet || null,
    bodyText: bodyText || null,
    bodyHtml: sanitizedHtml || null,
    labelIds: [...new Set(message.labelIds || [])],
    mimeType: message.payload.mimeType || null,
    sizeEstimate: Number(message.sizeEstimate) || null,
    hasAttachment: parsedParts.attachments.length > 0,
    recipients,
    attachments: parsedParts.attachments,
  };
};
