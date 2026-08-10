import db from "../config/db.js";

export const createMail = async (
  sender_user_id,
  receiver_user_id,
  from_email,
  to_email,
  cc,
  bcc,
  subject,
  body,
  status
) => {
  const [result] = await db.query(
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
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  return result;
};

// Get Inbox Mails with Pagination
export const getInboxMails = async (
  receiver_user_id,
  limit,
  offset
) => {
  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE receiver_user_id = ?
     AND receiver_is_deleted = FALSE
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [receiver_user_id, limit, offset]
  );

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS totalMails
     FROM mails
     WHERE receiver_user_id = ?
     AND receiver_is_deleted = FALSE`,
    [receiver_user_id]
  );

  return {
    mails: rows,
    totalMails: countResult[0].totalMails,
  };
};

export const findMailById = async (mailId) => {
  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE id = ?`,
    [mailId]
  );

  return rows[0];
};

// Get Sent Mails
export const getSentMails = async (sender_user_id) => {
  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE sender_user_id = ?
     AND sender_is_deleted = FALSE
     ORDER BY created_at DESC`,
    [sender_user_id]
  );

  return rows;
};

// Delete Sent Mail
export const deleteSentMailQuery = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET sender_is_deleted = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};

// Delete Received Mail
export const deleteReceivedMailQuery = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET receiver_is_deleted = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};

// Mark Mail As Read
export const markMailAsRead = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_read = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};

// Mark Mail As Starred
export const markMailAsStarred = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_starred = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};

// Mark Mail As Important
export const markMailAsImportant = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_important = TRUE
     WHERE id = ?
     `,
    [mailId]
  );

  return result;
};

// Archive Mail
export const markMailAsArchived = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_archived = TRUE
     WHERE id = ?
    `,
    [mailId]
  );

  return result;
};

// Mark Mail As Spam
export const markMailAsSpam = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_spam = TRUE
     WHERE id = ?
     `,
    [mailId]
  );

  return result;
};

export const getAllMails = async (userId) => {
  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE
       (
         sender_user_id = ?
         AND sender_is_deleted = FALSE
       )
       OR
       (
         receiver_user_id = ?
         AND receiver_is_deleted = FALSE
       )
     ORDER BY created_at DESC`,
    [userId, userId]
  );

  return rows;
};