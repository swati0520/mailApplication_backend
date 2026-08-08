import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import userRouter from "./routes/userRoutes.js";
import mailRouter from "./routes/mailRoutes.js"

import { connectDB } from "./config/db.js";

dotenv.config();
connectDB();



const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const port = process.env.PORT || 8081;

app.use(cors());
app.use(express.json());

app.set("view engine", "ejs");

app.get("/", (req, res) => {
  res.send("Welcome");
});

app.use("/users", userRouter);
app.use("/email", mailRouter);

// const usersMap = new Map();

// io.on("connection", (socket) => {
//   socket.on("adduser", (userId) => {
//     if (!userId) {
//       return;
//     }

//     const id = userId.toString();

//     usersMap.set(id, socket.id);
//   });

//   socket.on("sendMsg", async (ans) => {
//     try {


//       if (!ans?.to) {
//         socket.emit("messageError", {
//           message: "Receiver email is required",
//         });
//         return;
//       }

//       const receiverEmail = ans.to.trim().toLowerCase();

//       const friend = await User.findOne({
//         email: receiverEmail,
//       });

//       if (!friend) {


//         socket.emit("messageError", {
//           message: "Receiver user not found",
//         });

//         return;
//       }

//       const friendId = friend._id.toString();
//       const friendSocket = usersMap.get(friendId);

//       if (friendSocket) {
//         io.to(friendSocket).emit("receiveMsg", ans);
//       } else {


//         socket.emit("messageInfo", {
//           message: "Receiver is offline",
//         });
//       }
//     } catch (error) {


//       socket.emit("messageError", {
//         message: "Unable to send message",
//         error: error.message,
//       });
//     }
//   });

//   socket.on("disconnect", () => {


//     for (const [userId, socketId] of usersMap.entries()) {
//       if (socketId === socket.id) {
//         usersMap.delete(userId);

//         break;
//       }
//     }
//   });
// });

server.listen(port, () => {

  console.log(`Server is running on port ${port}`);
});