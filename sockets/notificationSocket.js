let io;

export const notificationSocket = (socketIO) => {
  io = socketIO;

  io.on("connection", (socket) => {
    // console.log("User connected:", socket.id);

    socket.on("joinNotification", (userId) => {
      if (!userId) return;

      socket.join(`user_${userId}`);
      // console.log(`User ${userId} joined notification room`);
    });

    socket.on("disconnect", () => {
      // console.log("User disconnected:", socket.id);
    });
  });
};

export const getIO = () => io;