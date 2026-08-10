import db from "../config/db.js";

export const createAttachment = async (
  mailId,
  userId,
  fileName,
  filePath,
  fileSize,
  fileType
) => {
  // Check whether user is sender or receiver of the mail
  const [mailRows] = await db.query(
    `SELECT id
     FROM mails
     WHERE id = ?
     AND (
       (sender_user_id = ? AND sender_is_deleted = FALSE)
       OR
       (receiver_user_id = ? AND receiver_is_deleted = FALSE)
     )`,
    [mailId, userId, userId]
  );

  if (mailRows.length === 0) {
    return null;
  }

  const [result] = await db.query(
    `INSERT INTO attachments
      (mail_id, file_name, file_path, file_size, file_type)
     VALUES (?, ?, ?, ?, ?)`,
    [
      mailId,
      fileName,
      filePath,
      fileSize,
      fileType,
    ]
  );

  return result;
};

export const getAttachments = async (mailId, userId) => {
  const [rows] = await db.query(
    `SELECT
       a.id,
       a.mail_id,
       a.file_name,
       a.file_path,
       a.file_size,
       a.file_type
     FROM attachments a
     INNER JOIN mails m
       ON a.mail_id = m.id
     WHERE a.mail_id = ?
     AND (
       (m.sender_user_id = ? AND m.sender_is_deleted = FALSE)
       OR
       (m.receiver_user_id = ? AND m.receiver_is_deleted = FALSE)
     )`,
    [mailId, userId, userId]
  );

  return rows;
};

export const deleteAttachment = async (id, userId) => {
  const [result] = await db.query(
    `DELETE a
     FROM attachments a
     INNER JOIN mails m
       ON a.mail_id = m.id
     WHERE a.id = ?
     AND (
       (m.sender_user_id = ? AND m.sender_is_deleted = FALSE)
       OR
       (m.receiver_user_id = ? AND m.receiver_is_deleted = FALSE)
     )`,
    [id, userId, userId]
  );

  return result;
};