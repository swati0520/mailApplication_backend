import expressAsyncHandler from "express-async-handler";

import {
  createNotifications,
  getNotifications,
  markNotificationAsRead,
  deleteNotification,
} from "../models/Notification.js";
import {
  findMailById,
  findMailForUser,
} from "../models/Mail.js";

import { getIO } from "../sockets/notificationSocket.js";

const authorizeNotificationMail = async (mailId, userId, res) => {
  const mail = await findMailById(mailId);
  if (!mail) {
    res.status(404).json({ message: "Mail not found" });
    return false;
  }

  const userMail = await findMailForUser(mailId, userId);
  if (!userMail) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  if (userMail.is_deleted || userMail.is_permanently_deleted) {
    res.status(404).json({ message: "Mail not found" });
    return false;
  }

  return true;
};

export const createNotification = expressAsyncHandler(async (req, res) => {
  const { mailId, title, message } = req.body;
  const { id } = req.user;

  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({
      message: "Title and message are required",
    });
  }

  const normalizedMailId =
    mailId === undefined || mailId === null || mailId === ""
      ? null
      : mailId;
  if (
    normalizedMailId !== null &&
    !(await authorizeNotificationMail(normalizedMailId, id, res))
  ) {
    return;
  }

  const result = await createNotifications(
    id,
    normalizedMailId,
    title.trim(),
    message.trim()
  );

  const notification = {
    id: result.insertId,
    userId: id,
    mailId: normalizedMailId,
    title: title.trim(),
    message: message.trim(),
    isRead: false,
  };

  const io = getIO();

  if (io) {
    io.to(`user_${id}`).emit("newNotification", notification);
  }

  return res.status(201).json({
    message: "Notification created successfully",
    notification,
  });
});

export const getUserNotifications = expressAsyncHandler(async (req, res) => {
  const notifications = await getNotifications(req.user.id);

  return res.status(200).json({
    message: "Notifications fetched successfully",
    notifications,
  });
});

export const readNotification = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await markNotificationAsRead(id, req.user.id);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    message: "Notification marked as read",
  });
});

export const removeNotification = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await deleteNotification(id, req.user.id);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    message: "Notification deleted successfully",
  });
});
