import express from "express";

import {
  generateGeminiResponse,
  summarizeEmail,
  generateReply,
  suggestSubject,
  getImportantPoints,
} from "../controllers/geminiController.js";
import checkToken from "../middleware/CheckToken.js";

const router = express.Router();
router.use(checkToken);

router.post("/generate", generateGeminiResponse);

router.post("/summarizeMail", summarizeEmail);

router.post("/generateReply", generateReply);

router.post("/suggestSubject", suggestSubject);

router.post("/importantPoints", getImportantPoints);
export default router;
