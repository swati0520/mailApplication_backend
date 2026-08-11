import jwt from "jsonwebtoken";

let io;

const getCookieToken = (cookieHeader) => {
  if (typeof cookieHeader !== "string") return null;

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = cookie.slice(0, separatorIndex).trim();
    if (name !== "token") continue;

    const value = cookie.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
};

const stripBearerPrefix = (value) =>
  typeof value === "string"
    ? value.replace(/^Bearer\s+/i, "")
    : null;

const getSocketToken = (socket) =>
  stripBearerPrefix(socket.handshake?.auth?.token) ||
  stripBearerPrefix(socket.handshake?.headers?.authorization) ||
  getCookieToken(socket.handshake?.headers?.cookie);

export const notificationSocket = (socketIO) => {
  io = socketIO;

  io.use((socket, next) => {
    const token = getSocketToken(socket);
    if (!token) return next(new Error("Unauthorized"));

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (!user?.id) return next(new Error("Unauthorized"));
      socket.user = user;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("joinNotification", () => {
      socket.join(`user_${socket.user.id}`);
    });
  });
};

export const getIO = () => io;
