import db from "../config/db.js";

export const findUserByEmail = async (email) => {
  const [rows] = await db.query(
    "SELECT * FROM users WHERE email = ?",
    [email]
  );
  return rows[0];
};

export const createUser = async (name, email, password) => {
  const [result] = await db.query(
    `INSERT INTO users (name, email, password)
     VALUES (?, ?, ?)`,
    [name, email, password]
  );
  return result;
};

export const updateResetToken = async (
  id,
  resetToken,
  resetPasswordExpires
) => {
  const [result] = await db.query(
    `UPDATE users
     SET reset_password_token = ?,
         reset_password_expires = ?
     WHERE id = ?`,
    [resetToken, resetPasswordExpires, id]
  );
  return result;
};

export const findValidResetToken = async (token) => {
  const [rows] = await db.query(
    `SELECT * FROM users
     WHERE reset_password_token = ?
       AND reset_password_expires > NOW()`,
    [token]
  );
  return rows[0];
};

export const updatePassword = async (id, hashedPassword) => {
  const [result] = await db.query(
    `UPDATE users
     SET password = ?,
         reset_password_token = NULL,
         reset_password_expires = NULL
     WHERE id = ?`,
    [hashedPassword, id]
  );
  return result;
};

export const updateUserQuery = async (
  id,
  name,
  email,
  profilePic
) => {
  const [result] = await db.query(
    `UPDATE users
     SET name = ?,
         email = ?,
         profile_pic = ?
     WHERE id = ?`,
    [name, email, profilePic, id]
  );
  return result;
};

export const deleteUserQuery = async (id) => {
  const [result] = await db.query(
    `DELETE FROM users WHERE id = ?`,
    [id]
  );
  return result;
};

export const findUserById = async (id) => {
  const [rows] = await db.query(
    `SELECT * FROM users WHERE id = ?`,
    [id]
  );
  return rows[0];
};

export const getAllUsers = async () => {
  const [rows] = await db.query(
    `SELECT id, name, email, profile_pic
     FROM users`
  );
  return rows;
};

export const searchUsers = async (search) => {
  const [rows] = await db.query(
    `SELECT id, name, email, profile_pic
     FROM users
     WHERE name LIKE ? OR email LIKE ?`,
    [`%${search}%`, `%${search}%`]
  );
  return rows;
};

export const findUserByGoogleId = async (googleId) => {
  const [rows] = await db.query(
    "SELECT * FROM users WHERE google_id = ?",
    [googleId]
  );
  return rows[0];
};

export const createGoogleUser = async (
  name,
  email,
  googleId,
  profilePic
) => {
  const [result] = await db.query(
    `INSERT INTO users
      (name, email, password, google_id, profile_pic)
     VALUES (?, ?, NULL, ?, ?)`,
    [name, email, googleId, profilePic]
  );
  return result;
};

export const updateGoogleId = async (id, googleId) => {
  const [result] = await db.query(
    `UPDATE users SET google_id = ? WHERE id = ?`,
    [googleId, id]
  );
  return result;
};

export const unlinkGoogleAccount = async (id) => {
  const [result] = await db.query(
    `UPDATE users SET google_id = NULL WHERE id = ?`,
    [id]
  );
  return result;
};
