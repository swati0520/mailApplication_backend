import expressAsyncHandler from "express-async-handler";

import {
  createAttachment,
  deleteAttachment,
  getAttachments,
} from "../models/Attachment.js";

export const uploadAttachment = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  if (!mailId) {
    return res.status(400).json({
      message: "Mail ID is required",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      message: "Attachment file is required",
    });
  }

  const file = req.file;

  const result = await createAttachment(
    mailId,
    userId,
    file.originalname,
    file.path,
    file.size,
    file.mimetype
  );

  if (result === null) {
    return res.status(403).json({
      message: "You are not authorized to add attachment to this mail",
    });
  }

  return res.status(201).json({
    message: "Attachment uploaded successfully",
    attachmentId: result.insertId,
  });
});

export const getAttachment = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.query;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  if (!mailId) {
    return res.status(400).json({
      message: "Mail ID is required",
    });
  }

  const data = await getAttachments(mailId, userId);

  return res.status(200).json({
    message: "Attachments fetched successfully",
    data,
  });
});

export const removeAttachment = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  const result = await deleteAttachment(id, userId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Attachment not found",
    });
  }

  return res.status(200).json({
    message: "Attachment deleted successfully",
  });
});