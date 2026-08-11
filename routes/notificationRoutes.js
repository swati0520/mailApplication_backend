import express from "express";

import {
  createNotification,
  getUserNotifications,
  readNotification,
  removeNotification,
} from "../controllers/notificationController.js";
import checkToken from "../middleware/CheckToken.js";

const router = express.Router();

router.post("/createNotification", checkToken, createNotification);

router.get("/getNotification", checkToken, getUserNotifications);

router.patch("/updateNotification/:id/read", checkToken, readNotification);

router.delete("/deleteNotification/:id", checkToken, removeNotification);

export default router;
