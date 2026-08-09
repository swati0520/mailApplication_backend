import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import cookieParser from "cookie-parser";

import geminiRouter from "./routes/geminiRoutes.js";
import userRouter from "./routes/userRoutes.js";
import mailRouter from "./routes/mailRoutes.js";
import attachmentRouter from "./routes/attachmentRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";

import passport from "./config/passport.js";

import { connectDB } from "./config/db.js";
import { notificationSocket } from "./sockets/notificationSocket.js";

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const port = process.env.PORT || 8081;

// Database
connectDB();

// Middleware
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

app.set("view engine", "ejs");

// Socket.IO
notificationSocket(io);

// Routes
app.get("/", (req, res) => {
  res.send("Welcome");
});

app.use("/users", userRouter);
app.use("/email", mailRouter);
app.use("/attachment", attachmentRouter);
app.use("/notification", notificationRouter);
app.use("/gemini", geminiRouter);

// Server
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});