import express from "express";

import {
  sendMail,
  deleteSentMail,
  deleteRecivedMail,
  getSentMail,
  getRecivedMail,
  getMailDetails,
  readMail,
  starMail,
  importantMail,
  archiveMail,
  spamMail,
  getAllMail,
} from "../controllers/mailController.js";

import checkToken from "../middleware/CheckToken.js";

const router = express.Router();

router.post("/create", checkToken, sendMail);

router.delete("/delete/sent/:_id", checkToken, deleteSentMail);
router.delete("/delete/received/:_id", checkToken, deleteRecivedMail);

router.get("/sentmails", checkToken, getSentMail);
router.get("/getMail", checkToken, getRecivedMail);
router.get("/all", checkToken, getAllMail);
router.get("/:mailId", checkToken, getMailDetails);

router.patch("/:mailId/read", checkToken, readMail);
router.patch("/:mailId/star", checkToken, starMail);

router.patch("/:mailId/important", checkToken, importantMail);

router.patch("/:mailId/archive", checkToken, archiveMail);

router.patch("/:mailId/spam", checkToken, spamMail);


export default router;