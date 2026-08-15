import dotenv from "dotenv";
dotenv.config();

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import passport from "./config/passport.js";

import { connectDB } from "./config/db.js";
import errorHandler from "./middleware/errorHandler.js";

import attachmentRouter from "./routes/attachmentRoutes.js";
import geminiRouter from "./routes/geminiRoutes.js";
import gmailRouter from "./routes/gmailRoutes.js";
import mailRouter from "./routes/mailRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import userRouter from "./routes/userRoutes.js";

import { startScheduledMailWorker } from "./services/mailService.js";
import { startGmailSyncWorker } from "./services/gmailSyncWorker.js";
import { notificationSocket } from "./sockets/notificationSocket.js";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8081;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// View engine
app.set("view engine", "ejs");

// Socket
notificationSocket(io);

// Health check
app.get("/", (req, res) => {
  res.status(200).send("Welcome");
});

// Routes
app.use("/users", userRouter);
app.use("/gmail", gmailRouter);
app.use("/email", mailRouter);
app.use("/attachment", attachmentRouter);
app.use("/notification", notificationRouter);
app.use("/gemini", geminiRouter);

// Error handler
app.use(errorHandler);



// Start server
const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      startScheduledMailWorker();
      startGmailSyncWorker();
    });
  } catch (error) {

    process.exit(1);
  }
};

startServer();
