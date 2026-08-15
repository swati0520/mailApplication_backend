import { createIncomingNotification } from "../models/Notification.js";
import { getIO } from "../sockets/notificationSocket.js";

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const notificationMessage = (subject) => {
  const normalized = typeof subject === "string" ? subject.trim() : "";
  return normalized || "(No subject)";
};

export const createInternalIncomingNotifications = async ({
  connection,
  mailId,
  senderUserId,
  senderEmail,
  subject,
  recipients,
  createNotification = createIncomingNotification,
}) => {
  const notifications = [];
  const seenUserIds = new Set();

  for (const recipient of Array.isArray(recipients) ? recipients : []) {
    const userId = recipient?.userId;
    const normalizedUserId = String(userId ?? "");
    if (
      !normalizedUserId ||
      normalizedUserId === String(senderUserId) ||
      seenUserIds.has(normalizedUserId)
    ) {
      continue;
    }
    seenUserIds.add(normalizedUserId);

    const notification = await createNotification({
      connection,
      userId,
      mailId,
      sourceKey: `internal:${mailId}`,
      title: `New mail from ${normalizeEmail(senderEmail) || "Unknown sender"}`,
      message: notificationMessage(subject),
    });
    if (notification) notifications.push(notification);
  }

  return notifications;
};

const isIncomingInboxMessage = (message, gmailEmail) => {
  const labels = new Set(Array.isArray(message?.labelIds) ? message.labelIds : []);
  return (
    labels.has("INBOX") &&
    !labels.has("SPAM") &&
    !labels.has("TRASH") &&
    normalizeEmail(message?.fromEmail) !== normalizeEmail(gmailEmail)
  );
};

export const createGmailIncomingNotifications = async ({
  connection,
  gmailConnectionId,
  userId,
  gmailEmail,
  insertedMessages,
  createNotification = createIncomingNotification,
}) => {
  const notifications = [];

  for (const { message } of
    Array.isArray(insertedMessages) ? insertedMessages : []) {
    if (!isIncomingInboxMessage(message, gmailEmail)) continue;

    const sender = message.fromName?.trim() ||
      normalizeEmail(message.fromEmail) ||
      "Unknown sender";
    const notification = await createNotification({
      connection,
      userId,
      mailId: null,
      sourceKey: `gmail:${gmailConnectionId}:${message.gmailMessageId}`,
      title: `New Gmail message from ${sender}`,
      message: notificationMessage(message.subject),
    });
    if (notification) notifications.push(notification);
  }

  return notifications;
};

export const emitNewNotifications = (notifications, io = getIO()) => {
  if (!io) return 0;

  let emitted = 0;
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    try {
      io.to(`user_${notification.userId}`).emit(
        "newNotification",
        notification
      );
      emitted += 1;
    } catch {
      // The durable notification remains available through the notifications API.
    }
  }
  return emitted;
};
