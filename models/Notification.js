import db from "../config/db.js"

export const createNotifications = async (
    userId,
    mailId,
    title,
    message
) => {
    const [result] = await db.query(
        `INSERT INTO notifications
   (user_id,mail_id, title,message)
   VALUES(?, ?, ?, ?)`,

        [userId, mailId, title, message]
    )
    return result
}

export const getNotifications = async (id) => {
  const [rows] = await db.query(
    `SELECT id, mail_id, title, message, is_read
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [id]
  );

  return rows;
};

export const markNotificationAsRead = async (id, userId) => {
  const [result] = await db.query(
    `UPDATE notifications
     SET is_read = TRUE
     WHERE id = ?
     AND user_id = ?`,
    [id, userId]
  );

  return result;
};

export const deleteNotification = async (id, userId) => {
  const [result] = await db.query(
    `DELETE FROM notifications
     WHERE id = ?
     AND user_id = ?`,
    [id, userId]
  );

  return result;
};

