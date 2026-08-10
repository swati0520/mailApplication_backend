import expressAsyncHandler from "express-async-handler";

import {
  createNotifications,
  getNotifications,
  markNotificationAsRead,
  deleteNotification,
} from "../models/Notification.js";

import { getIO } from "../sockets/notificationSocket.js";

export const createNotification = expressAsyncHandler(async (req, res) => {
  const { mailId, title, message } = req.body;
  const { id } = req.user;

  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({
      message: "Title and message are required",
    });
  }

  const result = await createNotifications(
    id,
    mailId || null,
    title.trim(),
    message.trim()
  );

  const notification = {
    id: result.insertId,
    userId: id,
    mailId: mailId || null,
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
  const { id } = req.user;

  const notifications = await getNotifications(id);

  return res.status(200).json({
    message: "Notifications fetched successfully",
    notifications,
  });
});

export const readNotification = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  const result = await markNotificationAsRead(id, userId);

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
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  const result = await deleteNotification(id, userId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    message: "Notification deleted successfully",
  });
});