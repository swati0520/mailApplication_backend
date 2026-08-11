import express from "express";
import {
  archiveMail,
  cancelSchedule,
  createDraftMail,
  deleteReceivedMail,
  deleteSentMail,
  emptyTrash,
  forwardMail,
  getAllMail,
  getArchivedMail,
  getImportantMail,
  getMailDetails,
  getReceivedMail,
  getSentMail,
  getSnoozedMail,
  getSpamMail,
  getStarredMail,
  getTrashMail,
  importantMail,
  listDraftMails,
  listScheduledMails,
  permanentlyDeleteMail,
  readMail,
  removeDraftMail,
  replyAllToMail,
  replyToMail,
  rescheduleMail,
  restoreMail,
  scheduleMail,
  searchMail,
  sendDraftMail,
  sendMail,
  spamMail,
  starMail,
  snoozeMail,
  unarchiveMail,
  unimportantMail,
  unreadMail,
  unspamMail,
  unstarMail,
  unsnoozeMail,
  updateDraftMail,
} from "../controllers/mailController.js";
import checkToken from "../middleware/CheckToken.js";
import attachmentUpload from "../middleware/attachmentUpload.js";

const router = express.Router();

router.post(
  "/create",
  checkToken,
  attachmentUpload.array("attachments", 10),
  sendMail
);

router.delete("/delete/sent/:_id", checkToken, deleteSentMail);
router.delete("/delete/received/:_id", checkToken, deleteReceivedMail);

router.get("/sentmails", checkToken, getSentMail);
router.get("/getMail", checkToken, getReceivedMail);
router.get("/all", checkToken, getAllMail);
router.get("/starred", checkToken, getStarredMail);
router.get("/important", checkToken, getImportantMail);
router.get("/archived", checkToken, getArchivedMail);
router.get("/spam", checkToken, getSpamMail);
router.get("/snoozed", checkToken, getSnoozedMail);
router.get("/trash", checkToken, getTrashMail);
router.get("/search", checkToken, searchMail);

router.post("/draft", checkToken, createDraftMail);
router.get("/drafts", checkToken, listDraftMails);
router.put("/draft/:mailId", checkToken, updateDraftMail);
router.delete("/draft/:mailId", checkToken, removeDraftMail);
router.post("/draft/:mailId/send", checkToken, sendDraftMail);

router.post("/schedule", checkToken, scheduleMail);
router.get("/scheduled", checkToken, listScheduledMails);
router.put("/scheduled/:mailId", checkToken, rescheduleMail);
router.delete("/scheduled/:mailId", checkToken, cancelSchedule);

router.delete("/trash/empty", checkToken, emptyTrash);
router.patch("/:mailId/restore", checkToken, restoreMail);
router.delete("/:mailId/permanent", checkToken, permanentlyDeleteMail);

router.patch("/:mailId/read", checkToken, readMail);
router.patch("/:mailId/unread", checkToken, unreadMail);
router.patch("/:mailId/star", checkToken, starMail);
router.patch("/:mailId/unstar", checkToken, unstarMail);
router.patch("/:mailId/important", checkToken, importantMail);
router.patch("/:mailId/unimportant", checkToken, unimportantMail);
router.patch("/:mailId/archive", checkToken, archiveMail);
router.patch("/:mailId/unarchive", checkToken, unarchiveMail);
router.patch("/:mailId/spam", checkToken, spamMail);
router.patch("/:mailId/unspam", checkToken, unspamMail);
router.patch("/:mailId/snooze", checkToken, snoozeMail);
router.patch("/:mailId/unsnooze", checkToken, unsnoozeMail);

router.post("/:mailId/reply", checkToken, replyToMail);
router.post("/:mailId/reply-all", checkToken, replyAllToMail);
router.post("/:mailId/forward", checkToken, forwardMail);

router.get("/:mailId", checkToken, getMailDetails);

export default router;
