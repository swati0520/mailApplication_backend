import db from "../config/db.js";

export const getAttachmentMailAccess = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT
       mails.id,
       mails.sender_user_id,
       mails.receiver_user_id,
       mails.status,
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
     WHERE mails.id = ?`,
    [userId, userId, mailId]
  );
  const mail = rows[0];
  if (!mail) return { status: "not_found" };

  const isSender = String(mail.sender_user_id) === String(userId);
  const isRecipient =
    Boolean(mail.recipient_user_id) ||
    (
      !mail.has_recipients &&
      String(mail.receiver_user_id) === String(userId)
    );
  if (!isSender && !isRecipient) return { status: "forbidden" };

  const activeState =
    mail.mailbox_role &&
    !mail.is_deleted &&
    !mail.is_permanently_deleted;
  if (!activeState) return { status: "not_found" };

  return { status: "allowed", mail };
};

export const createAttachment = async (
  mailId,
  fileName,
  filePath,
  fileSize,
  fileType
) => {
  const [result] = await db.query(
    `INSERT INTO attachments
      (mail_id, file_name, file_path, file_size, file_type)
     VALUES (?, ?, ?, ?, ?)`,
    [mailId, fileName, filePath, fileSize, fileType]
  );
  return result;
};

export const createAttachmentRows = async (
  connection,
  mailId,
  attachments
) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return;
  const placeholders = attachments.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const values = attachments.flatMap((attachment) => [
    mailId,
    attachment.fileName,
    attachment.filePath,
    attachment.fileSize,
    attachment.fileType,
  ]);
  await connection.query(
    `INSERT INTO attachments
      (mail_id, file_name, file_path, file_size, file_type)
     VALUES ${placeholders}`,
    values
  );
};

export const getAttachments = async (mailId) => {
  const [rows] = await db.query(
    `SELECT id, mail_id, file_name, file_size, file_type, created_at, updated_at
     FROM attachments
     WHERE mail_id = ?
     ORDER BY created_at, id`,
    [mailId]
  );
  return rows;
};

export const getAttachmentById = async (id) => {
  const [rows] = await db.query(
    `SELECT id, mail_id, file_name, file_path, file_size, file_type
     FROM attachments
     WHERE id = ?`,
    [id]
  );
  return rows[0];
};

export const getAuthorizedAttachment = async (id, userId) => {
  const attachment = await getAttachmentById(id);
  if (!attachment) return { status: "not_found" };
  const access = await getAttachmentMailAccess(attachment.mail_id, userId);
  if (access.status !== "allowed") return { status: access.status };
  return { status: "allowed", attachment };
};

export const deleteAttachment = async (id, mailId) => {
  const [result] = await db.query(
    `DELETE FROM attachments WHERE id = ? AND mail_id = ?`,
    [id, mailId]
  );
  return result;
};
