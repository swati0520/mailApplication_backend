import db from "../config/db.js";
import {
  createInternalIncomingNotifications,
  emitNewNotifications,
} from "../services/incomingMailNotificationService.js";
import { createAttachmentRows } from "./Attachment.js";

const sharedMailSelect = `
  mails.id,
  mails.sender_user_id,
  mails.receiver_user_id,
  mails.from_email,
  mails.to_email,
  mails.cc,
  mails.bcc,
  mails.subject,
  mails.body,
  mails.status,
  mails.gmail_delivery_status,
  mails.gmail_message_id,
  mails.gmail_thread_id,
  mails.gmail_delivery_error_code,
  mails.gmail_delivery_error_message,
  mails.gmail_delivery_updated_at,
  mails.thread_id,
  mails.sender_is_deleted,
  mails.receiver_is_deleted,
  mails.scheduled_at,
  mails.label,
  mails.created_at,
  mails.updated_at`;

const stateSelect = `
  state.mailbox_role,
  state.is_read AS is_read,
  state.is_starred AS is_starred,
  state.is_important AS is_important,
  state.is_archived AS is_archived,
  state.is_spam AS is_spam,
  state.is_snoozed AS is_snoozed,
  state.snoozed_until AS snoozed_until,
  state.is_deleted AS is_deleted,
  state.deleted_at AS deleted_at,
  state.is_permanently_deleted AS is_permanently_deleted,
  state.permanently_deleted_at AS permanently_deleted_at`;

const recipientMembershipCondition = `
  (
    EXISTS (
      SELECT 1
      FROM mail_recipients membership
      WHERE membership.mail_id = mails.id
        AND membership.user_id = state.user_id
    )
    OR (
      mails.receiver_user_id = state.user_id
      AND NOT EXISTS (
        SELECT 1
        FROM mail_recipients any_recipient
        WHERE any_recipient.mail_id = mails.id
      )
    )
  )`;

const visibleMailCondition = `
  state.is_deleted = FALSE
  AND state.is_permanently_deleted = FALSE
  AND (
    (
      state.mailbox_role = 'sender'
      AND mails.sender_user_id = state.user_id
    )
    OR
    (
      state.mailbox_role = 'receiver'
      AND ${recipientMembershipCondition}
    )
  )`;

const allowedStateColumns = new Set([
  "is_read",
  "is_starred",
  "is_important",
  "is_archived",
  "is_spam",
]);

const allowedMailboxRoles = new Set(["sender", "receiver"]);
const allowedRecipientTypes = new Set(["to", "cc", "bcc"]);
const allowedGmailDeliveryStatuses = new Set([
  "internal_only",
  "pending",
  "sent",
  "failed",
]);

const insertStateRows = (connection, mailId, senderId, receiverId) =>
  connection.query(
    `INSERT INTO mail_user_state
      (
        mail_id,
        user_id,
        mailbox_role,
        is_read,
        is_starred,
        is_important,
        is_archived,
        is_spam
      )
      VALUES
        (?, ?, 'sender', TRUE, FALSE, FALSE, FALSE, FALSE),
        (?, ?, 'receiver', FALSE, FALSE, FALSE, FALSE, FALSE)`,
    [mailId, senderId, mailId, receiverId]
  );

const validateRecipientRows = (recipients) => {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("At least one mail recipient is required");
  }

  const userIds = new Set();
  for (const recipient of recipients) {
    if (
      !recipient?.userId ||
      !allowedRecipientTypes.has(recipient.recipientType) ||
      typeof recipient.email !== "string" ||
      !recipient.email.trim()
    ) {
      throw new Error("Invalid mail recipient");
    }
    if (userIds.has(String(recipient.userId))) {
      throw new Error("Duplicate mail recipient");
    }
    userIds.add(String(recipient.userId));
  }
};

export const createMailRecipients = async (
  connection,
  mailId,
  recipients
) => {
  validateRecipientRows(recipients);
  const placeholders = recipients.map(() => "(?, ?, ?, ?)").join(", ");
  const values = recipients.flatMap((recipient) => [
    mailId,
    recipient.userId,
    recipient.recipientType,
    recipient.email.trim().toLowerCase(),
  ]);

  const [result] = await connection.query(
    `INSERT INTO mail_recipients
      (mail_id, user_id, recipient_type, email_snapshot)
     VALUES ${placeholders}`,
    values
  );
  return result;
};

const insertMultiRecipientStateRows = async (
  connection,
  mailId,
  senderId,
  recipients
) => {
  const rows = [
    [mailId, senderId, "sender", true],
    ...recipients.map((recipient) => [
      mailId,
      recipient.userId,
      "receiver",
      false,
    ]),
  ];
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, NULL, FALSE, NULL)")
    .join(", ");

  await connection.query(
    `INSERT INTO mail_user_state
      (
        mail_id,
        user_id,
        mailbox_role,
        is_read,
        is_starred,
        is_important,
        is_archived,
        is_spam,
        is_snoozed,
        snoozed_until,
        is_deleted,
        deleted_at,
        is_permanently_deleted,
        permanently_deleted_at
      )
     VALUES ${placeholders}`,
    rows.flat()
  );
};

export const getMailRecipients = async (mailId, requestingUserId) => {
  const [rows] = await db.query(
    `SELECT
       recipients.mail_id,
       recipients.user_id,
       recipients.recipient_type,
       recipients.email_snapshot,
       recipients.created_at
     FROM mail_recipients recipients
     INNER JOIN mails ON mails.id = recipients.mail_id
     WHERE recipients.mail_id = ?
       AND (
         mails.sender_user_id = ?
         OR EXISTS (
           SELECT 1
           FROM mail_recipients membership
           WHERE membership.mail_id = recipients.mail_id
             AND membership.user_id = ?
         )
       )
       AND (
         mails.sender_user_id = ?
         OR recipients.recipient_type <> 'bcc'
         OR recipients.user_id = ?
       )
     ORDER BY FIELD(recipients.recipient_type, 'to', 'cc', 'bcc'), recipients.created_at`,
    [
      mailId,
      requestingUserId,
      requestingUserId,
      requestingUserId,
      requestingUserId,
    ]
  );
  return rows;
};

export const getUserMailRecipient = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT mail_id, user_id, recipient_type, email_snapshot, created_at
     FROM mail_recipients
     WHERE mail_id = ? AND user_id = ?`,
    [mailId, userId]
  );
  return rows[0];
};

export const isUserMailRecipient = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM mail_recipients membership
       WHERE membership.mail_id = mails.id
         AND membership.user_id = ?
     ) OR (
       mails.receiver_user_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM mail_recipients any_recipient
         WHERE any_recipient.mail_id = mails.id
       )
     ) AS is_recipient
     FROM mails
     WHERE mails.id = ?`,
    [userId, userId, mailId]
  );
  return Boolean(rows[0]?.is_recipient);
};

export const getMailRecipientsByType = async (
  mailId,
  recipientType,
  requestingUserId
) => {
  if (!allowedRecipientTypes.has(recipientType)) {
    throw new Error("Invalid recipient type");
  }

  const recipients = await getMailRecipients(mailId, requestingUserId);
  return recipients.filter(
    (recipient) => recipient.recipient_type === recipientType
  );
};

const queryPaginatedMails = async (
  whereClause,
  params,
  limit,
  offset
) => {
  const joins = `
    FROM mails
    INNER JOIN mail_user_state state
      ON state.mail_id = mails.id
     AND state.user_id = ?`;

  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}, ${stateSelect}
     ${joins}
     WHERE ${whereClause}
     ORDER BY mails.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS totalMails
     ${joins}
     WHERE ${whereClause}`,
    params
  );

  return {
    mails: rows,
    totalMails: countRows[0].totalMails,
  };
};

export const createMail = async (
  sender_user_id,
  receiver_user_id,
  from_email,
  to_email,
  cc,
  bcc,
  subject,
  body,
  status,
  thread_id = null,
  recipients = null,
  attachments = [],
  gmail_delivery_status = "internal_only",
  gmail_message_id = null,
  gmail_thread_id = null
) => {
  if (!allowedGmailDeliveryStatuses.has(gmail_delivery_status)) {
    throw new Error("Invalid Gmail delivery status");
  }
  const connection = await db.getConnection();
  let notifications = [];

  try {
    await connection.beginTransaction();

    const recipientRows = recipients ?? [
      {
        userId: receiver_user_id,
        recipientType: "to",
        email: to_email,
      },
    ];
    validateRecipientRows(recipientRows);
    if (
      recipientRows.some(
        (recipient) => String(recipient.userId) === String(sender_user_id)
      )
    ) {
      throw new Error("Sender cannot also be a mail recipient");
    }

    const [result] = await connection.query(
      `INSERT INTO mails
        (
          sender_user_id,
          receiver_user_id,
          from_email,
          to_email,
          cc,
          bcc,
          subject,
          body,
          status,
          gmail_delivery_status,
          gmail_message_id,
          gmail_thread_id,
          thread_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sender_user_id,
        receiver_user_id,
        from_email,
        to_email,
        cc,
        bcc,
        subject,
        body,
        status,
        gmail_delivery_status,
        gmail_message_id,
        gmail_thread_id,
        thread_id,
      ]
    );

    await createMailRecipients(
      connection,
      result.insertId,
      recipientRows
    );
    await insertMultiRecipientStateRows(
      connection,
      result.insertId,
      sender_user_id,
      recipientRows
    );
    await createAttachmentRows(
      connection,
      result.insertId,
      attachments
    );
    if (status === "sent") {
      notifications = await createInternalIncomingNotifications({
        connection,
        mailId: result.insertId,
        senderUserId: sender_user_id,
        senderEmail: from_email,
        subject,
        recipients: recipientRows,
      });
    }

    await connection.commit();
    emitNewNotifications(notifications);
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateMailGmailDelivery = async ({
  mailId,
  senderUserId,
  deliveryStatus,
  gmailMessageId = null,
  gmailThreadId = null,
  errorCode = null,
  errorMessage = null,
}) => {
  if (!allowedGmailDeliveryStatuses.has(deliveryStatus)) {
    throw new Error("Invalid Gmail delivery status");
  }
  const [result] = await db.query(
    `UPDATE mails
     SET gmail_delivery_status = ?,
         gmail_message_id = ?,
         gmail_thread_id = ?,
         gmail_delivery_error_code = ?,
         gmail_delivery_error_message = ?,
         gmail_delivery_updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND sender_user_id = ?`,
    [
      deliveryStatus,
      gmailMessageId,
      gmailThreadId,
      errorCode,
      errorMessage,
      mailId,
      senderUserId,
    ]
  );
  return result;
};

export const createReplyAllMail = async (
  originalMailId,
  currentUserId,
  currentUserEmail,
  requestedSubject,
  body,
  gmailDelivery = null
) => {
  const connection = await db.getConnection();
  let notifications = [];

  try {
    await connection.beginTransaction();
    const [originalRows] = await connection.query(
      `SELECT
         mails.id,
         mails.sender_user_id,
         mails.receiver_user_id,
         mails.subject,
         mails.thread_id,
         sender.email AS sender_email,
         state.mailbox_role,
         state.is_deleted,
         state.is_permanently_deleted,
         caller_recipient.user_id AS recipient_user_id,
         EXISTS (
           SELECT 1
           FROM mail_recipients any_recipient
           WHERE any_recipient.mail_id = mails.id
         ) AS has_recipients
       FROM mails
       LEFT JOIN users sender ON sender.id = mails.sender_user_id
       LEFT JOIN mail_user_state state
         ON state.mail_id = mails.id
        AND state.user_id = ?
       LEFT JOIN mail_recipients caller_recipient
         ON caller_recipient.mail_id = mails.id
        AND caller_recipient.user_id = ?
       WHERE mails.id = ?
       FOR UPDATE`,
      [currentUserId, currentUserId, originalMailId]
    );
    const original = originalRows[0];

    if (!original) {
      await connection.rollback();
      return { status: "not_found" };
    }

    const isSender =
      original.mailbox_role === "sender" &&
      String(original.sender_user_id) === String(currentUserId);
    const isRecipient =
      original.mailbox_role === "receiver" &&
      (
        Boolean(original.recipient_user_id) ||
        (
          !original.has_recipients &&
          String(original.receiver_user_id) === String(currentUserId)
        )
      );

    if (!isSender && !isRecipient) {
      await connection.rollback();
      return { status: "forbidden" };
    }
    if (original.is_deleted || original.is_permanently_deleted) {
      await connection.rollback();
      return { status: "not_found" };
    }

    const [visibleRecipientRows] = await connection.query(
      `SELECT
         recipients.user_id,
         recipients.recipient_type,
         users.email
       FROM mail_recipients recipients
       INNER JOIN users ON users.id = recipients.user_id
       WHERE recipients.mail_id = ?
         AND recipients.recipient_type IN ('to', 'cc')
       ORDER BY
         FIELD(recipients.recipient_type, 'to', 'cc'),
         CASE WHEN recipients.user_id = ? THEN 0 ELSE 1 END,
         recipients.created_at,
         recipients.user_id`,
      [originalMailId, original.receiver_user_id]
    );

    if (!original.has_recipients && original.receiver_user_id) {
      const [legacyRows] = await connection.query(
        `SELECT id AS user_id, email, 'to' AS recipient_type
         FROM users
         WHERE id = ?`,
        [original.receiver_user_id]
      );
      visibleRecipientRows.push(...legacyRows);
    }

    const candidates = [];
    if (original.sender_user_id && original.sender_email) {
      candidates.push({
        user_id: original.sender_user_id,
        email: original.sender_email,
        recipient_type: "to",
      });
    }
    candidates.push(...visibleRecipientRows);

    const normalizedCurrentEmail = currentUserEmail.trim().toLowerCase();
    const seenUserIds = new Set();
    const seenEmails = new Set();
    const recipients = [];

    for (const candidate of candidates) {
      const email = candidate.email?.trim().toLowerCase();
      const userId = String(candidate.user_id);
      if (
        !email ||
        userId === String(currentUserId) ||
        email === normalizedCurrentEmail ||
        seenUserIds.has(userId) ||
        seenEmails.has(email)
      ) {
        continue;
      }

      seenUserIds.add(userId);
      seenEmails.add(email);
      recipients.push({
        userId: candidate.user_id,
        email,
        recipientType: candidate.recipient_type,
      });
    }

    if (recipients.length === 0) {
      await connection.rollback();
      return { status: "no_recipients" };
    }

    let primaryTo = recipients.find(
      (recipient) => recipient.recipientType === "to"
    );
    if (!primaryTo) {
      recipients[0].recipientType = "to";
      primaryTo = recipients[0];
    }

    const ccEmails = recipients
      .filter((recipient) => recipient.recipientType === "cc")
      .map((recipient) => recipient.email);
    const threadId = original.thread_id || `thread-${original.id}`;
    if (!original.thread_id) {
      await connection.query(
        `UPDATE mails SET thread_id = ? WHERE id = ? AND thread_id IS NULL`,
        [threadId, original.id]
      );
    }
    const subject =
      typeof requestedSubject === "string" && requestedSubject.trim()
        ? requestedSubject.trim()
        : original.subject.startsWith("Re:")
          ? original.subject
          : `Re: ${original.subject}`;

    const [result] = await connection.query(
      `INSERT INTO mails
        (
          sender_user_id,
          receiver_user_id,
          from_email,
          to_email,
          cc,
          bcc,
          subject,
          body,
          status,
          gmail_delivery_status,
          gmail_message_id,
          gmail_thread_id,
          thread_id
        )
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'sent', ?, ?, ?, ?)`,
      [
        currentUserId,
        primaryTo.userId,
        normalizedCurrentEmail,
        primaryTo.email,
        ccEmails.length ? JSON.stringify(ccEmails) : null,
        subject,
        body,
        gmailDelivery?.deliveryStatus ?? "internal_only",
        gmailDelivery?.gmailMessageId ?? null,
        gmailDelivery?.gmailThreadId ?? null,
        threadId,
      ]
    );

    await createMailRecipients(connection, result.insertId, recipients);
    await insertMultiRecipientStateRows(
      connection,
      result.insertId,
      currentUserId,
      recipients
    );
    notifications = await createInternalIncomingNotifications({
      connection,
      mailId: result.insertId,
      senderUserId: currentUserId,
      senderEmail: normalizedCurrentEmail,
      subject,
      recipients,
    });

    await connection.commit();
    emitNewNotifications(notifications);
    return {
      status: "sent",
      mailId: result.insertId,
      threadId,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getInboxMails = (receiverId, limit, offset) =>
  queryPaginatedMails(
    `state.mailbox_role = 'receiver'
     AND ${recipientMembershipCondition}
     AND mails.status = 'sent'
     AND state.is_deleted = FALSE
     AND state.is_permanently_deleted = FALSE
     AND state.is_archived = FALSE
     AND state.is_spam = FALSE
     AND state.is_snoozed = FALSE`,
    [receiverId],
    limit,
    offset
  );

export const findMailById = async (mailId) => {
  const [rows] = await db.query(
    `SELECT
       id,
       sender_user_id,
       receiver_user_id,
       sender_is_deleted,
       receiver_is_deleted,
       status
     FROM mails
     WHERE id = ?`,
    [mailId]
  );

  return rows[0];
};

export const findMailForUser = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}, ${stateSelect}
     FROM mails
     INNER JOIN mail_user_state state
       ON state.mail_id = mails.id
      AND state.user_id = ?
     WHERE mails.id = ?
       AND (
         (state.mailbox_role = 'sender' AND mails.sender_user_id = state.user_id)
         OR (
           state.mailbox_role = 'receiver'
           AND ${recipientMembershipCondition}
         )
       )`,
    [userId, mailId]
  );

  return rows[0];
};

export const getSentMails = (senderId, limit, offset) =>
  queryPaginatedMails(
    `mails.sender_user_id = ?
     AND state.mailbox_role = 'sender'
     AND mails.status = 'sent'
     AND state.is_deleted = FALSE
     AND state.is_permanently_deleted = FALSE
     AND state.is_snoozed = FALSE`,
    [senderId, senderId],
    limit,
    offset
  );

export const getAllMails = (userId, limit, offset) =>
  queryPaginatedMails(
    `mails.status = 'sent'
     AND state.is_snoozed = FALSE
     AND (${visibleMailCondition})`,
    [userId],
    limit,
    offset
  );

export const getStateFolderMails = (
  userId,
  stateField,
  limit,
  offset
) => {
  if (!allowedStateColumns.has(stateField) || stateField === "is_read") {
    throw new Error("Invalid mail folder state");
  }

  return queryPaginatedMails(
    `mails.status = 'sent'
     AND state.${stateField} = TRUE
     AND state.is_snoozed = FALSE
     AND (${visibleMailCondition})`,
    [userId],
    limit,
    offset
  );
};

export const searchMails = (userId, search, limit, offset) => {
  const value = `%${search}%`;
  return queryPaginatedMails(
    `mails.status = 'sent'
     AND (${visibleMailCondition})
     AND (
       mails.subject LIKE ?
       OR mails.body LIKE ?
       OR mails.from_email LIKE ?
       OR mails.to_email LIKE ?
     )`,
    [userId, value, value, value, value],
    limit,
    offset
  );
};

export const deleteSentMailQuery = async (mailId, userId) => {
  const [result] = await db.query(
    `UPDATE mails
     INNER JOIN mail_user_state state
       ON state.mail_id = mails.id
      AND state.user_id = ?
     SET
       state.is_deleted = TRUE,
       state.deleted_at = NOW(),
       mails.sender_is_deleted = TRUE
     WHERE mails.id = ?
       AND mails.sender_user_id = state.user_id
       AND state.mailbox_role = 'sender'
       AND state.is_deleted = FALSE
       AND state.is_permanently_deleted = FALSE`,
    [userId, mailId]
  );
  return result;
};

export const deleteReceivedMailQuery = async (mailId, userId) => {
  const [result] = await db.query(
    `UPDATE mails
     INNER JOIN mail_user_state state
       ON state.mail_id = mails.id
      AND state.user_id = ?
     LEFT JOIN mail_recipients recipient
       ON recipient.mail_id = mails.id
      AND recipient.user_id = state.user_id
     SET
       state.is_deleted = TRUE,
       state.deleted_at = NOW(),
       mails.receiver_is_deleted = CASE
         WHEN mails.receiver_user_id = state.user_id THEN TRUE
         ELSE mails.receiver_is_deleted
       END
     WHERE mails.id = ?
       AND state.mailbox_role = 'receiver'
       AND ${recipientMembershipCondition}
       AND state.is_deleted = FALSE
       AND state.is_permanently_deleted = FALSE`,
    [userId, mailId]
  );
  return result;
};

export const getTrashMails = (userId, limit, offset) =>
  queryPaginatedMails(
    `mails.status = 'sent'
     AND state.is_deleted = TRUE
     AND state.is_permanently_deleted = FALSE
     AND (
       (state.mailbox_role = 'sender' AND mails.sender_user_id = state.user_id)
       OR (
         state.mailbox_role = 'receiver'
         AND ${recipientMembershipCondition}
       )
     )`,
    [userId],
    limit,
    offset
  );

export const restoreMailCopy = async (mailId, userId) => {
  const [result] = await db.query(
    `UPDATE mails
     INNER JOIN mail_user_state state
       ON state.mail_id = mails.id
      AND state.user_id = ?
     SET
       state.is_deleted = FALSE,
       state.deleted_at = NULL,
       mails.sender_is_deleted = CASE
         WHEN state.mailbox_role = 'sender' THEN FALSE
         ELSE mails.sender_is_deleted
       END,
       mails.receiver_is_deleted = CASE
         WHEN state.mailbox_role = 'receiver'
          AND mails.receiver_user_id = state.user_id THEN FALSE
         ELSE mails.receiver_is_deleted
       END
     WHERE mails.id = ?
       AND state.is_deleted = TRUE
       AND state.is_permanently_deleted = FALSE
       AND (
         (state.mailbox_role = 'sender' AND mails.sender_user_id = state.user_id)
         OR (
           state.mailbox_role = 'receiver'
           AND ${recipientMembershipCondition}
         )
       )`,
    [userId, mailId]
  );
  return result;
};

const permanentlyDeleteCopy = async (connection, mailId, userId) => {
  const [rows] = await connection.query(
    `SELECT
       mails.sender_user_id,
       mails.receiver_user_id,
       state.mailbox_role,
       state.is_deleted,
       state.is_permanently_deleted,
       recipient.user_id AS recipient_user_id,
       EXISTS (
         SELECT 1
         FROM mail_recipients any_recipient
         WHERE any_recipient.mail_id = mails.id
       ) AS has_recipients
     FROM mails
     LEFT JOIN mail_user_state state
       ON state.mail_id = mails.id
      AND state.user_id = ?
     LEFT JOIN mail_recipients recipient
       ON recipient.mail_id = mails.id
      AND recipient.user_id = ?
     WHERE mails.id = ?
     FOR UPDATE`,
    [userId, userId, mailId]
  );

  const mail = rows[0];
  if (!mail) return "not_found";

  const isSender =
    mail.mailbox_role === "sender" &&
    String(mail.sender_user_id) === String(userId);
  const isReceiver =
    mail.mailbox_role === "receiver" &&
    (
      Boolean(mail.recipient_user_id) ||
      (
        !mail.has_recipients &&
        String(mail.receiver_user_id) === String(userId)
      )
    );
  if (!isSender && !isReceiver) return "forbidden";
  if (!mail.is_deleted || mail.is_permanently_deleted) return "not_in_trash";

  await connection.query(
    `UPDATE mail_user_state
     SET is_permanently_deleted = TRUE,
         permanently_deleted_at = NOW()
     WHERE mail_id = ?
       AND user_id = ?
       AND is_deleted = TRUE
       AND is_permanently_deleted = FALSE`,
    [mailId, userId]
  );

  return "deleted";
};

export const permanentlyDeleteMailCopy = async (mailId, userId) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const status = await permanentlyDeleteCopy(connection, mailId, userId);
    await connection.commit();
    return status;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const emptyTrashForUser = async (userId) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE mail_user_state state
       INNER JOIN mails ON mails.id = state.mail_id
       LEFT JOIN mail_recipients recipient
         ON recipient.mail_id = mails.id
        AND recipient.user_id = state.user_id
       SET
         state.is_permanently_deleted = TRUE,
         state.permanently_deleted_at = NOW()
       WHERE state.user_id = ?
         AND state.is_deleted = TRUE
         AND state.is_permanently_deleted = FALSE
         AND (
           (state.mailbox_role = 'sender' AND mails.sender_user_id = state.user_id)
           OR (
             state.mailbox_role = 'receiver'
             AND (
               recipient.user_id IS NOT NULL
               OR (
                 mails.receiver_user_id = state.user_id
                 AND NOT EXISTS (
                   SELECT 1
                   FROM mail_recipients any_recipient
                   WHERE any_recipient.mail_id = mails.id
                 )
               )
             )
           )
         )`,
      [userId]
    );

    await connection.commit();
    return result.affectedRows;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateMailState = async (
  mailId,
  userId,
  stateField,
  value,
  allowedRoles
) => {
  if (!allowedStateColumns.has(stateField)) {
    throw new Error("Invalid mail state field");
  }
  if (
    !Array.isArray(allowedRoles) ||
    allowedRoles.length === 0 ||
    allowedRoles.some((role) => !allowedMailboxRoles.has(role))
  ) {
    throw new Error("Invalid mailbox role restriction");
  }

  const rolePlaceholders = allowedRoles.map(() => "?").join(", ");
  const [result] = await db.query(
    `UPDATE mail_user_state state
     INNER JOIN mails ON mails.id = state.mail_id
     SET state.${stateField} = ?
     WHERE state.mail_id = ?
       AND state.user_id = ?
       AND state.mailbox_role IN (${rolePlaceholders})
       AND (${visibleMailCondition})`,
    [Boolean(value), mailId, userId, ...allowedRoles]
  );
  return result;
};

export const markMailAsRead = (mailId, userId) =>
  updateMailState(mailId, userId, "is_read", true, ["receiver"]);
export const markMailAsUnread = (mailId, userId) =>
  updateMailState(mailId, userId, "is_read", false, ["receiver"]);
export const markMailAsStarred = (mailId, userId) =>
  updateMailState(mailId, userId, "is_starred", true, ["sender", "receiver"]);
export const markMailAsUnstarred = (mailId, userId) =>
  updateMailState(mailId, userId, "is_starred", false, ["sender", "receiver"]);
export const markMailAsImportant = (mailId, userId) =>
  updateMailState(mailId, userId, "is_important", true, ["sender", "receiver"]);
export const markMailAsUnimportant = (mailId, userId) =>
  updateMailState(mailId, userId, "is_important", false, ["sender", "receiver"]);
export const markMailAsArchived = (mailId, userId) =>
  updateMailState(mailId, userId, "is_archived", true, ["sender", "receiver"]);
export const markMailAsUnarchived = (mailId, userId) =>
  updateMailState(mailId, userId, "is_archived", false, ["sender", "receiver"]);
export const markMailAsSpam = (mailId, userId) =>
  updateMailState(mailId, userId, "is_spam", true, ["receiver"]);
export const markMailAsUnspam = (mailId, userId) =>
  updateMailState(mailId, userId, "is_spam", false, ["receiver"]);

export const snoozeMailState = async (mailId, userId, snoozedUntil) => {
  const [result] = await db.query(
    `UPDATE mail_user_state state
     INNER JOIN mails ON mails.id = state.mail_id
     SET state.is_snoozed = TRUE,
         state.snoozed_until = ?
     WHERE state.mail_id = ?
       AND state.user_id = ?
       AND ? > NOW()
       AND (${visibleMailCondition})`,
    [snoozedUntil, mailId, userId, snoozedUntil]
  );
  return result;
};

export const unsnoozeMailState = async (mailId, userId) => {
  const [result] = await db.query(
    `UPDATE mail_user_state state
     INNER JOIN mails ON mails.id = state.mail_id
     SET state.is_snoozed = FALSE,
         state.snoozed_until = NULL
     WHERE state.mail_id = ?
       AND state.user_id = ?
       AND (${visibleMailCondition})`,
    [mailId, userId]
  );
  return result;
};

export const getSnoozedMails = (userId, limit, offset) =>
  queryPaginatedMails(
    `mails.status = 'sent'
     AND state.is_snoozed = TRUE
     AND (${visibleMailCondition})`,
    [userId],
    limit,
    offset
  );

export const wakeExpiredSnoozedMails = async () => {
  const [result] = await db.query(
    `UPDATE mail_user_state
     SET is_snoozed = FALSE,
         snoozed_until = NULL
     WHERE is_snoozed = TRUE
       AND snoozed_until IS NOT NULL
       AND snoozed_until <= NOW()`
  );
  return result.affectedRows;
};

export const createDraft = async (
  senderId,
  receiverId,
  fromEmail,
  toEmail,
  cc,
  bcc,
  subject,
  body
) => {
  const [result] = await db.query(
    `INSERT INTO mails
      (sender_user_id, receiver_user_id, from_email, to_email, cc, bcc, subject, body, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [senderId, receiverId, fromEmail, toEmail, cc, bcc, subject, body]
  );
  return result;
};

export const findOwnedDraft = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}
     FROM mails
     WHERE mails.id = ? AND mails.sender_user_id = ? AND mails.status = 'draft'`,
    [mailId, userId]
  );
  return rows[0];
};

export const updateDraft = async (
  mailId,
  userId,
  receiverId,
  toEmail,
  cc,
  bcc,
  subject,
  body
) => {
  const [result] = await db.query(
    `UPDATE mails
     SET receiver_user_id = ?, to_email = ?, cc = ?, bcc = ?, subject = ?, body = ?
     WHERE id = ?
       AND sender_user_id = ?
       AND status = 'draft'
       AND gmail_delivery_status <> 'pending'`,
    [receiverId, toEmail, cc, bcc, subject, body, mailId, userId]
  );
  return result;
};

export const getDraftMails = async (userId, limit, offset) => {
  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}
     FROM mails
     WHERE mails.sender_user_id = ? AND mails.status = 'draft'
     ORDER BY mails.updated_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  const [counts] = await db.query(
    `SELECT COUNT(*) AS totalMails FROM mails WHERE sender_user_id = ? AND status = 'draft'`,
    [userId]
  );
  return { mails: rows, totalMails: counts[0].totalMails };
};

export const deleteDraft = async (mailId, userId) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [draftRows] = await connection.query(
      `SELECT id FROM mails
       WHERE id = ?
         AND sender_user_id = ?
         AND status = 'draft'
         AND gmail_delivery_status <> 'pending'
       FOR UPDATE`,
      [mailId, userId]
    );
    if (!draftRows[0]) {
      await connection.rollback();
      return { affectedRows: 0, attachmentPaths: [] };
    }
    const [attachmentRows] = await connection.query(
      `SELECT file_path FROM attachments WHERE mail_id = ?`,
      [mailId]
    );
    await connection.query(`DELETE FROM attachments WHERE mail_id = ?`, [mailId]);
    const [result] = await connection.query(
      `DELETE FROM mails WHERE id = ? AND sender_user_id = ? AND status = 'draft'`,
      [mailId, userId]
    );
    await connection.commit();
    return {
      ...result,
      attachmentPaths: attachmentRows.map((row) => row.file_path),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const claimDraftForSend = async (mailId, userId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET gmail_delivery_status = 'pending',
         gmail_delivery_error_code = NULL,
         gmail_delivery_error_message = NULL,
         gmail_delivery_updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND sender_user_id = ?
       AND status = 'draft'
       AND gmail_delivery_status <> 'pending'`,
    [mailId, userId]
  );
  return result;
};

export const finalizeDraftSend = async ({
  mailId,
  userId,
  receiverId,
  toEmail,
  cc,
  bcc,
  recipients,
  gmailDeliveryStatus,
  gmailMessageId = null,
  gmailThreadId = null,
}) => {
  validateRecipientRows(recipients);
  if (recipients.some(({ userId: recipientUserId }) =>
    String(recipientUserId) === String(userId))) {
    throw new Error("Sender cannot also be a mail recipient");
  }
  if (!["internal_only", "sent"].includes(gmailDeliveryStatus)) {
    throw new Error("Invalid completed Gmail delivery status");
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM mails
       WHERE id = ?
         AND sender_user_id = ?
         AND status = 'draft'
         AND gmail_delivery_status = 'pending'
       FOR UPDATE`,
      [mailId, userId]
    );
    const draft = rows[0];
    if (!draft) {
      await connection.rollback();
      return { status: "not_found" };
    }

    await connection.query(
      `UPDATE mails
       SET receiver_user_id = ?,
           to_email = ?,
           cc = ?,
           bcc = ?,
           status = 'sent',
           scheduled_at = NULL,
           gmail_delivery_status = ?,
           gmail_message_id = ?,
           gmail_thread_id = ?,
           gmail_delivery_error_code = NULL,
           gmail_delivery_error_message = NULL,
           gmail_delivery_updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND sender_user_id = ? AND status = 'draft'`,
      [
        receiverId,
        toEmail,
        cc,
        bcc,
        gmailDeliveryStatus,
        gmailMessageId,
        gmailThreadId,
        mailId,
        userId,
      ]
    );
    await createMailRecipients(connection, mailId, recipients);
    await insertMultiRecipientStateRows(
      connection,
      mailId,
      draft.sender_user_id,
      recipients
    );
    await connection.commit();
    return { status: "sent", mailId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const createScheduledMail = async (
  senderId,
  receiverId,
  fromEmail,
  toEmail,
  subject,
  body,
  scheduledAt
) => {
  const [result] = await db.query(
    `INSERT INTO mails
      (sender_user_id, receiver_user_id, from_email, to_email, subject, body, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    [senderId, receiverId, fromEmail, toEmail, subject, body, scheduledAt]
  );
  return result;
};

export const getScheduledMails = async (userId, limit, offset) => {
  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}
     FROM mails
     WHERE mails.sender_user_id = ? AND mails.status = 'scheduled'
     ORDER BY mails.scheduled_at ASC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  const [counts] = await db.query(
    `SELECT COUNT(*) AS totalMails FROM mails WHERE sender_user_id = ? AND status = 'scheduled'`,
    [userId]
  );
  return { mails: rows, totalMails: counts[0].totalMails };
};

export const updateScheduledMail = async (
  mailId,
  userId,
  receiverId,
  toEmail,
  subject,
  body,
  scheduledAt
) => {
  const [result] = await db.query(
    `UPDATE mails
     SET receiver_user_id = ?, to_email = ?, subject = ?, body = ?, scheduled_at = ?
     WHERE id = ? AND sender_user_id = ? AND status = 'scheduled'`,
    [receiverId, toEmail, subject, body, scheduledAt, mailId, userId]
  );
  return result;
};

export const findOwnedScheduledMail = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT ${sharedMailSelect}
     FROM mails
     WHERE mails.id = ? AND mails.sender_user_id = ? AND mails.status = 'scheduled'`,
    [mailId, userId]
  );
  return rows[0];
};

export const cancelScheduledMail = async (mailId, userId) => {
  const [result] = await db.query(
    `DELETE FROM mails WHERE id = ? AND sender_user_id = ? AND status = 'scheduled'`,
    [mailId, userId]
  );
  return result;
};

export const processDueScheduledMails = async () => {
  let processed = 0;

  while (true) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM mails
         WHERE status = 'scheduled' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT 1
         FOR UPDATE`
      );
      const mail = rows[0];
      if (!mail) {
        await connection.commit();
        connection.release();
        break;
      }

      await insertStateRows(
        connection,
        mail.id,
        mail.sender_user_id,
        mail.receiver_user_id
      );
      await connection.query(
        `UPDATE mails SET status = 'sent' WHERE id = ? AND status = 'scheduled'`,
        [mail.id]
      );
      await connection.commit();
      processed += 1;
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
    connection.release();
  }

  return processed;
};

export const setMailThreadId = async (mailId, threadId) => {
  const [result] = await db.query(
    `UPDATE mails SET thread_id = ? WHERE id = ? AND thread_id IS NULL`,
    [threadId, mailId]
  );
  return result;
};
