const hasLabel = (labels, label) => labels.includes(label);

export const adaptGmailMessage = (message) => {
  const labelIds = Array.isArray(message.label_ids)
    ? message.label_ids
    : JSON.parse(message.label_ids || "[]");

  const adapted = {
    id: message.gmail_message_id,
    source: "gmail",
    gmailMessageId: message.gmail_message_id,
    gmailThreadId: message.gmail_thread_id,
    rfcMessageId: message.rfc_message_id,
    from_email: message.from_email,
    from_name: message.from_name,
    subject: message.subject,
    snippet: message.snippet,
    body: message.body_text,
    body_html: message.body_html,
    labelIds,
    mime_type: message.mime_type,
    size_estimate: message.size_estimate,
    has_attachment: Boolean(message.has_attachment),
    created_at: message.internal_date,
    synced_at: message.synced_at,
    is_read: !hasLabel(labelIds, "UNREAD"),
    is_starred: hasLabel(labelIds, "STARRED"),
    is_important: hasLabel(labelIds, "IMPORTANT"),
    is_archived:
      !hasLabel(labelIds, "INBOX") &&
      !hasLabel(labelIds, "SPAM") &&
      !hasLabel(labelIds, "TRASH"),
    is_spam: hasLabel(labelIds, "SPAM"),
    is_deleted: hasLabel(labelIds, "TRASH"),
    is_snoozed: false,
    mailbox_role: hasLabel(labelIds, "SENT") ? "sender" : "receiver",
  };

  if (Array.isArray(message.recipients)) {
    adapted.recipients = message.recipients.map((recipient) => ({
      recipient_type: recipient.recipient_type,
      email: recipient.email,
      display_name: recipient.display_name,
    }));

    const recipientEmails = (type) => adapted.recipients
      .filter((recipient) => recipient.recipient_type === type)
      .map((recipient) => recipient.email)
      .filter(Boolean);
    const toEmails = recipientEmails("to");
    const ccEmails = recipientEmails("cc");
    const bccEmails = recipientEmails("bcc");

    adapted.to_email = toEmails.join(", ");
    adapted.cc = ccEmails.join(", ");
    adapted.bcc = bccEmails.join(", ");
    adapted.recipient = adapted.to_email;
  }

  if (Array.isArray(message.attachments)) {
    adapted.attachments = message.attachments.map((attachment) => ({
      gmailAttachmentId: attachment.gmail_attachment_id,
      mimePartId: attachment.mime_part_id,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      size: attachment.size,
      cacheStatus: attachment.cache_status,
    }));
  }

  return adapted;
};
