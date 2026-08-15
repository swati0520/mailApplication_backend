import db from "../config/db.js";

export const createNotifications = async (
  userId,
  mailId,
  title,
  message
) => {
  const [result] = await db.query(
    `INSERT INTO notifications (user_id, mail_id, title, message)
     VALUES (?, ?, ?, ?)`,
    [userId, mailId, title, message]
  );
  return result;
};

export const createIncomingNotification = async ({
  connection = db,
  userId,
  mailId = null,
  sourceKey,
  title,
  message,
}) => {
  const [existingRows] = await connection.query(
    `SELECT id
     FROM notifications
     WHERE user_id = ? AND source_key = ?
     LIMIT 1`,
    [userId, sourceKey]
  );
  if (existingRows[0]) return null;

  const [result] = await connection.query(
    `INSERT INTO notifications
       (user_id, mail_id, source_key, title, message)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, mailId, sourceKey, title, message]
  );

  return {
    id: result.insertId,
    userId,
    mailId,
    title,
    message,
    isRead: false,
  };
};

export const getNotifications = async (userId) => {
  const [rows] = await db.query(
    `SELECT id, mail_id, title, message, is_read
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

export const markNotificationAsRead = async (id, userId) => {
  const [result] = await db.query(
    `UPDATE notifications
     SET is_read = TRUE
     WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return result;
};

export const deleteNotification = async (id, userId) => {
  const [result] = await db.query(
    `DELETE FROM notifications
     WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return result;
};
