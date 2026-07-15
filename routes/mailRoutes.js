import express from "express";

import {
  sendMail,
  deleteSentMail,
  deleteRecivedMail,
  getSentMail,
  getRecivedMail,
} from "../controllers/mailController.js";

import checkToken from "../middleware/CheckToken.js";

const router = express.Router();

router.post("/create", checkToken, sendMail);

router.delete("/delete/sent/:_id", checkToken, deleteSentMail);
router.delete("/delete/received/:_id", checkToken, deleteRecivedMail);

router.get("/sentmails", checkToken, getSentMail);
router.get("/getMail", checkToken, getRecivedMail);

export default router;