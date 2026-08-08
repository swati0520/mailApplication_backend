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


// Get 
export const getInboxMails = async (receiver_user_id) => {

  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE receiver_user_id = ?
     AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [receiver_user_id]
  );

  return rows;
};

export const findMailById = async (mailId) => {
  const [rows] = await db.query(
    `SELECT * FROM mails
    WHERE id = ? AND is_deleted = FALSE`,
    [mailId]
  );
  return rows[0]
};

// Get SENT 
export const getSentMails = async (sender_user_id) => {

  const [rows] = await db.query(
    `SELECT *
     FROM mails
     WHERE sender_user_id = ?
     AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [sender_user_id]
  );

  return rows;
};

// Delete sent 
export const deleteSentMailQuery = async (mailId) => {

  const [result] = await db.query(
    `UPDATE mails
     SET is_deleted = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};
// Delete Received

export const deleteReceivedMailQuery = async (mailId) => {

  const [result] = await db.query(
    `UPDATE mails
     SET is_deleted = TRUE
     WHERE id = ?`,
    [mailId]
  );

  return result;
};

export const markMailAsRead = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
  SET is_read = TRUE
  WHERE id = ?
  AND is_deleted = FALSE`,
    [mailId]
  )
  return result
};
export const markMailAsStarred = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_starred = TRUE
     WHERE id = ?
     AND is_deleted = FALSE`,
    [mailId]
  );

  return result;
};

export const markMailAsImportant = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails 
    SET is_important = TRUE
    WHERE id = ?
    AND is_deleted = FALSE`,
    [mailId]
  )
  return result

}

export const markMailAsArchived = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails 
    SET is_archived = TRUE
    WHERE id = ?
    AND is_deleted = FALSE`,
    [mailId]
  )
  return result

}
export const markMailAsSpam = async (mailId) => {
  const [result] = await db.query(
    `UPDATE mails
     SET is_spam = TRUE
     WHERE id = ?
     AND is_deleted = FALSE`,
    [mailId]
  );

  return result;
};


