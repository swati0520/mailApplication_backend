import express from "express";
import {
  connectGmail,
  disconnectGmail,
  getGmailConnectionStatus,
  gmailOAuthCallback,
} from "../controllers/gmailController.js";
import checkToken from "../middleware/CheckToken.js";
import {
  archiveGmailMessageController,
  deleteGmailMessage,
  forwardGmailMessageController,
  getCachedGmailMessage,
  getGmailAttachment,
  getGmailSyncStatus,
  importantGmailMessage,
  listCachedGmailMessages,
  readGmailMessage,
  replyAllGmailMessage,
  replyGmailMessage,
  spamGmailMessage,
  starGmailMessageController,
  syncGmailMessages,
  unarchiveGmailMessageController,
  unimportantGmailMessage,
  unreadGmailMessage,
  unspamGmailMessage,
  unstarGmailMessageController,
} from "../controllers/gmailMessageController.js";

const router = express.Router();

router.get("/connect", checkToken, connectGmail);
router.get("/callback", checkToken, gmailOAuthCallback);
router.get("/status", checkToken, getGmailConnectionStatus);
router.get("/messages", checkToken, listCachedGmailMessages);
router.get(
  "/messages/:gmailMessageId/attachments/:gmailAttachmentId",
  checkToken,
  getGmailAttachment
);
router.delete("/messages/:gmailMessageId", checkToken, deleteGmailMessage);
router.patch("/messages/:gmailMessageId/archive", checkToken, archiveGmailMessageController);
router.patch("/messages/:gmailMessageId/unarchive", checkToken, unarchiveGmailMessageController);
router.patch("/messages/:gmailMessageId/read", checkToken, readGmailMessage);
router.patch("/messages/:gmailMessageId/unread", checkToken, unreadGmailMessage);
router.patch("/messages/:gmailMessageId/star", checkToken, starGmailMessageController);
router.patch("/messages/:gmailMessageId/unstar", checkToken, unstarGmailMessageController);
router.patch("/messages/:gmailMessageId/important", checkToken, importantGmailMessage);
router.patch("/messages/:gmailMessageId/unimportant", checkToken, unimportantGmailMessage);
router.patch("/messages/:gmailMessageId/spam", checkToken, spamGmailMessage);
router.patch("/messages/:gmailMessageId/unspam", checkToken, unspamGmailMessage);
router.post("/messages/:gmailMessageId/reply", checkToken, replyGmailMessage);
router.post("/messages/:gmailMessageId/reply-all", checkToken, replyAllGmailMessage);
router.post("/messages/:gmailMessageId/forward", checkToken, forwardGmailMessageController);
router.get("/messages/:gmailMessageId", checkToken, getCachedGmailMessage);
router.post("/sync", checkToken, syncGmailMessages);
router.get("/sync/status", checkToken, getGmailSyncStatus);
router.delete("/disconnect", checkToken, disconnectGmail);

export default router;
