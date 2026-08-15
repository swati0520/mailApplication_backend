import db from "../config/db.js";
import {
  createGmailIncomingNotifications,
  emitNewNotifications,
} from "../services/incomingMailNotificationService.js";

const MESSAGE_SELECT = `
  messages.id,
  messages.gmail_connection_id,
  messages.gmail_message_id,
  messages.gmail_thread_id,
  messages.rfc_message_id,
  messages.history_id,
  messages.internal_date,
  messages.from_email,
  messages.from_name,
  messages.subject,
  messages.snippet,
  messages.body_text,
  messages.body_html,
  messages.label_ids,
  messages.mime_type,
  messages.size_estimate,
  messages.has_attachment,
  messages.synced_at`;

const serializeLabels = (labels) => JSON.stringify([...new Set(labels)].sort());

export const encodeGmailPageToken = (message) =>
  Buffer.from(JSON.stringify({
    date: new Date(message.internal_date).toISOString(),
    id: String(message.id),
  })).toString("base64url");

export const decodeGmailPageToken = (token) => {
  if (!token) return null;

  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const date = new Date(value.date);
    if (Number.isNaN(date.getTime()) || !/^\d+$/.test(String(value.id))) {
      throw new Error();
    }
    return { date, id: value.id };
  } catch {
    throw new Error("Invalid Gmail page token");
  }
};

export const listGmailMessagesForUser = async ({
  userId,
  limit,
  pageToken,
}) => {
  const cursor = decodeGmailPageToken(pageToken);
  const cursorClause = cursor
    ? "AND (messages.internal_date < ? OR (messages.internal_date = ? AND messages.id < ?))"
    : "";
  const params = cursor
    ? [userId, cursor.date, cursor.date, cursor.id, limit + 1]
    : [userId, limit + 1];
  const [rows] = await db.query(
    `SELECT ${MESSAGE_SELECT}
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE connections.user_id = ?
       AND connections.connection_status = 'connected'
       AND messages.remote_deleted = FALSE
       ${cursorClause}
     ORDER BY messages.internal_date DESC, messages.id DESC
     LIMIT ?`,
    params
  );
  const hasNextPage = rows.length > limit;
  const messages = hasNextPage ? rows.slice(0, limit) : rows;

  return {
    messages,
    nextPageToken: hasNextPage
      ? encodeGmailPageToken(messages[messages.length - 1])
      : null,
  };
};

export const getGmailInboxMessagesForUser = async (
  userId,
  limit,
  offset
) => {
  const inboxConditions = `
    connections.user_id = ?
    AND connections.connection_status = 'connected'
    AND messages.remote_deleted = FALSE
    AND JSON_CONTAINS(messages.label_ids, '"INBOX"')
    AND NOT JSON_CONTAINS(messages.label_ids, '"SPAM"')
    AND NOT JSON_CONTAINS(messages.label_ids, '"TRASH"')`;

  const [rows] = await db.query(
    `SELECT ${MESSAGE_SELECT}
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE ${inboxConditions}
     ORDER BY messages.internal_date DESC, messages.id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS totalMails
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE ${inboxConditions}`,
    [userId]
  );

  return {
    messages: rows,
    totalMails: Number(countRows[0]?.totalMails) || 0,
  };
};

export const getGmailSentMessagesForUser = async (
  userId,
  limit,
  offset
) => {
  const sentConditions = `
    connections.user_id = ?
    AND connections.connection_status = 'connected'
    AND messages.remote_deleted = FALSE
    AND JSON_CONTAINS(messages.label_ids, '"SENT"')
    AND NOT JSON_CONTAINS(messages.label_ids, '"TRASH"')
    AND NOT EXISTS (
      SELECT 1
      FROM mails internal_mail
      WHERE internal_mail.sender_user_id = connections.user_id
        AND internal_mail.gmail_message_id = messages.gmail_message_id
    )`;

  const [rows] = await db.query(
    `SELECT ${MESSAGE_SELECT}
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE ${sentConditions}
     ORDER BY messages.internal_date DESC, messages.id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS totalMails
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE ${sentConditions}`,
    [userId]
  );

  return {
    messages: rows,
    totalMails: Number(countRows[0]?.totalMails) || 0,
  };
};

export const findGmailMessageForUser = async (gmailMessageId, userId) => {
  const [rows] = await db.query(
    `SELECT ${MESSAGE_SELECT}
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     WHERE messages.gmail_message_id = ?
       AND connections.user_id = ?
       AND connections.connection_status = 'connected'
       AND messages.remote_deleted = FALSE`,
    [gmailMessageId, userId]
  );
  const message = rows[0];
  if (!message) return undefined;

  const [recipients] = await db.query(
    `SELECT recipient_type, email, display_name
     FROM gmail_message_recipients
     WHERE gmail_message_record_id = ?
     ORDER BY FIELD(recipient_type, 'to', 'cc', 'bcc'), id`,
    [message.id]
  );
  const [attachments] = await db.query(
    `SELECT
       gmail_attachment_id,
       mime_part_id,
       filename,
       mime_type,
       size,
       cache_status
     FROM gmail_attachments
     WHERE gmail_message_record_id = ?
     ORDER BY id`,
    [message.id]
  );

  return { ...message, recipients, attachments };
};

export const findGmailAttachmentForUser = async ({
  gmailMessageId,
  gmailAttachmentId,
  userId,
}) => {
  const [rows] = await db.query(
    `SELECT
       messages.gmail_connection_id,
       messages.gmail_message_id,
       attachments.gmail_attachment_id,
       attachments.mime_part_id,
       attachments.filename,
       attachments.mime_type,
       attachments.size
     FROM gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     LEFT JOIN gmail_attachments attachments
       ON attachments.gmail_message_record_id = messages.id
      AND attachments.gmail_attachment_id = ?
     WHERE messages.gmail_message_id = ?
       AND connections.user_id = ?
       AND messages.remote_deleted = FALSE
     LIMIT 1`,
    [gmailAttachmentId, gmailMessageId, userId]
  );
  const row = rows[0];
  if (!row) return { status: "message_not_found" };
  if (!row.gmail_attachment_id) return { status: "attachment_not_found" };
  return { status: "allowed", attachment: row };
};

export const updateGmailMessageLabelsForUser = async ({
  gmailMessageId,
  userId,
  labelIds,
}) => {
  const [result] = await db.query(
    `UPDATE gmail_messages messages
     INNER JOIN gmail_connections connections
       ON connections.id = messages.gmail_connection_id
     SET messages.label_ids = ?,
         messages.synced_at = NOW()
     WHERE messages.gmail_message_id = ?
       AND connections.user_id = ?
       AND connections.connection_status = 'connected'`,
    [serializeLabels(labelIds), gmailMessageId, userId]
  );
  return result;
};

export const markGmailMessageTrashedForUser = updateGmailMessageLabelsForUser;

const insertRecipients = async (connection, messageRecordId, recipients) => {
  if (!recipients.length) return;
  const placeholders = recipients.map(() => "(?, ?, ?, ?)").join(", ");
  const values = recipients.flatMap((recipient) => [
    messageRecordId,
    recipient.recipientType,
    recipient.email,
    recipient.displayName,
  ]);
  await connection.query(
    `INSERT INTO gmail_message_recipients
       (gmail_message_record_id, recipient_type, email, display_name)
     VALUES ${placeholders}`,
    values
  );
};

const insertAttachments = async (connection, messageRecordId, attachments) => {
  if (!attachments.length) return;
  const placeholders = attachments.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
  const values = attachments.flatMap((attachment) => [
    messageRecordId,
    attachment.gmailAttachmentId,
    attachment.mimePartId,
    attachment.filename,
    attachment.mimeType,
    attachment.size,
  ]);
  await connection.query(
    `INSERT INTO gmail_attachments
       (gmail_message_record_id, gmail_attachment_id, mime_part_id,
        filename, mime_type, size)
     VALUES ${placeholders}`,
    values
  );
};

export const upsertGmailMessage = async (
  connection,
  gmailConnectionId,
  message
) => {
  const [existingRows] = await connection.query(
    `SELECT id
     FROM gmail_messages
     WHERE gmail_connection_id = ? AND gmail_message_id = ?
     LIMIT 1`,
    [gmailConnectionId, message.gmailMessageId]
  );
  const [result] = await connection.query(
    `INSERT INTO gmail_messages (
       gmail_connection_id,
       gmail_message_id,
       gmail_thread_id,
       rfc_message_id,
       history_id,
       internal_date,
       from_email,
       from_name,
       subject,
       snippet,
       body_text,
       body_html,
       label_ids,
       mime_type,
       size_estimate,
       has_attachment,
       remote_deleted,
       synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW())
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       gmail_thread_id = VALUES(gmail_thread_id),
       rfc_message_id = VALUES(rfc_message_id),
       history_id = VALUES(history_id),
       internal_date = VALUES(internal_date),
       from_email = VALUES(from_email),
       from_name = VALUES(from_name),
       subject = VALUES(subject),
       snippet = VALUES(snippet),
       body_text = VALUES(body_text),
       body_html = VALUES(body_html),
       label_ids = VALUES(label_ids),
       mime_type = VALUES(mime_type),
       size_estimate = VALUES(size_estimate),
       has_attachment = VALUES(has_attachment),
       remote_deleted = FALSE,
       synced_at = NOW()`,
    [
      gmailConnectionId,
      message.gmailMessageId,
      message.gmailThreadId,
      message.rfcMessageId,
      message.historyId,
      message.internalDate,
      message.fromEmail,
      message.fromName,
      message.subject,
      message.snippet,
      message.bodyText,
      message.bodyHtml,
      serializeLabels(message.labelIds),
      message.mimeType,
      message.sizeEstimate,
      message.hasAttachment,
    ]
  );
  const messageRecordId = result.insertId;

  await connection.query(
    `DELETE FROM gmail_message_recipients
     WHERE gmail_message_record_id = ?`,
    [messageRecordId]
  );
  await connection.query(
    `DELETE FROM gmail_attachments
     WHERE gmail_message_record_id = ?`,
    [messageRecordId]
  );
  await insertRecipients(connection, messageRecordId, message.recipients);
  await insertAttachments(connection, messageRecordId, message.attachments);

  return {
    messageRecordId,
    isNew: !existingRows[0],
  };
};

export const persistGmailMessages = async ({
  gmailConnectionId,
  messages,
}) => persistGmailChanges({ gmailConnectionId, messages });

const markGmailMessagesRemoteDeleted = async (
  connection,
  gmailConnectionId,
  gmailMessageIds
) => {
  if (!gmailMessageIds.length) return;

  const placeholders = gmailMessageIds.map(() => "?").join(", ");
  await connection.query(
    `UPDATE gmail_messages
     SET remote_deleted = TRUE,
         synced_at = NOW()
     WHERE gmail_connection_id = ?
       AND gmail_message_id IN (${placeholders})`,
    [gmailConnectionId, ...gmailMessageIds]
  );
};

export const persistGmailChanges = async ({
  gmailConnectionId,
  messages = [],
  deletedMessageIds = [],
}) => {
  const connection = await db.getConnection();
  let notifications = [];
  try {
    await connection.beginTransaction();
    const [gmailConnectionRows] = await connection.query(
      `SELECT user_id, gmail_email
       FROM gmail_connections
       WHERE id = ?`,
      [gmailConnectionId]
    );
    const gmailConnection = gmailConnectionRows[0];
    if (!gmailConnection) {
      throw new Error("Gmail connection not found while persisting messages");
    }

    const insertedMessages = [];
    for (const message of messages) {
      const persisted = await upsertGmailMessage(
        connection,
        gmailConnectionId,
        message
      );
      if (persisted.isNew) {
        insertedMessages.push({
          messageRecordId: persisted.messageRecordId,
          message,
        });
      }
    }
    notifications = await createGmailIncomingNotifications({
      connection,
      gmailConnectionId,
      userId: gmailConnection.user_id,
      gmailEmail: gmailConnection.gmail_email,
      insertedMessages,
    });
    await markGmailMessagesRemoteDeleted(
      connection,
      gmailConnectionId,
      [...new Set(deletedMessageIds)]
    );
    await connection.commit();
    emitNewNotifications(notifications);
    return { notifications };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
