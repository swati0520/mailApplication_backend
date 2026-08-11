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
import mailRouter from "./routes/mailRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import userRouter from "./routes/userRoutes.js";
import { startScheduledMailWorker } from "./services/mailService.js";
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

connectDB();
startScheduledMailWorker();

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

notificationSocket(io);

app.get("/", (req, res) => {
  res.send("Welcome");
});
app.use("/users", userRouter);
app.use("/email", mailRouter);
app.use("/attachment", attachmentRouter);
app.use("/notification", notificationRouter);
app.use("/gemini", geminiRouter);
app.use(errorHandler);

server.listen(port);
