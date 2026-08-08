import db from "../config/db.js"

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

export const getAttachments = async () => {
  const [rows] = await db.query(
    `SELECT id, mail_id, file_name, file_path, file_size, file_type
     FROM attachments`
  );

  return rows;
};

export const deleteAttachment = async (id) => {
  const [result] = await db.query(
    `DELETE FROM attachments
     WHERE id = ?`,
    [id]
  );

  return result;
};