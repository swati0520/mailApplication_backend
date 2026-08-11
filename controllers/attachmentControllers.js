import expressAsyncHandler from "express-async-handler";

import {
  createAttachment,
  deleteAttachment,
  getAttachmentMailAccess,
  getAttachments,
  getAuthorizedAttachment,
} from "../models/Attachment.js";
import {
  persistAttachmentFile,
  removeAttachmentFile,
  resolveAttachmentPath,
} from "../utils/attachmentStorage.js";

const sendAccessError = (res, status) => {
  if (status === "forbidden") {
    return res.status(403).json({ message: "Forbidden" });
  }
  return res.status(404).json({ message: "Mail or attachment not found" });
};

export const uploadAttachment = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.body;
  if (!mailId) {
    return res.status(400).json({ message: "Mail ID is required" });
  }
  if (!req.file) {
    return res.status(400).json({ message: "Attachment file is required" });
  }

  const access = await getAttachmentMailAccess(mailId, req.user.id);
  if (access.status !== "allowed") {
    return sendAccessError(res, access.status);
  }

  let storedFile;
  try {
    storedFile = await persistAttachmentFile(req.file);
    const result = await createAttachment(
      mailId,
      storedFile.fileName,
      storedFile.filePath,
      storedFile.fileSize,
      storedFile.fileType
    );
    return res.status(201).json({
      message: "Attachment uploaded successfully",
      attachmentId: result.insertId,
    });
  } catch (error) {
    if (storedFile) {
      await removeAttachmentFile(storedFile.filePath).catch(() => {});
    }
    throw error;
  }
});

export const getAttachment = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.query;
  if (!mailId) {
    return res.status(400).json({ message: "Mail ID is required" });
  }

  const access = await getAttachmentMailAccess(mailId, req.user.id);
  if (access.status !== "allowed") {
    return sendAccessError(res, access.status);
  }
  const data = await getAttachments(mailId);
  return res.status(200).json({
    message: "Attachments fetched successfully",
    data,
  });
});

export const downloadAttachment = expressAsyncHandler(
  async (req, res, next) => {
    const result = await getAuthorizedAttachment(req.params.id, req.user.id);
    if (result.status !== "allowed") {
      return sendAccessError(res, result.status);
    }

    let absolutePath;
    try {
      absolutePath = resolveAttachmentPath(result.attachment.file_path);
    } catch {
      return res.status(500).json({ message: "Attachment storage path is invalid" });
    }

    return res.download(
      absolutePath,
      result.attachment.file_name,
      (error) => {
        if (!error) return;
        if (error.code === "ENOENT" && !res.headersSent) {
          res.status(404).json({ message: "Attachment file not found" });
          return;
        }
        if (!res.headersSent) next(error);
      }
    );
  }
);

export const removeAttachment = expressAsyncHandler(async (req, res) => {
  const result = await getAuthorizedAttachment(req.params.id, req.user.id);
  if (result.status !== "allowed") {
    return sendAccessError(res, result.status);
  }

  let fileResult;
  try {
    fileResult = await removeAttachmentFile(result.attachment.file_path);
  } catch {
    return res.status(500).json({
      message: "Attachment file could not be deleted",
    });
  }

  const deleteResult = await deleteAttachment(
    result.attachment.id,
    result.attachment.mail_id
  );
  if (deleteResult.affectedRows === 0) {
    return res.status(404).json({ message: "Attachment not found" });
  }

  return res.status(200).json({
    message: "Attachment deleted successfully",
    fileAlreadyMissing: fileResult.alreadyMissing,
  });
});
