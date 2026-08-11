import expressAsyncHandler from "express-async-handler";
import {
  askGemini,
  extractImportantPoints,
  generateMailReply,
  suggestMailSubject,
  summarizeMail,
} from "../services/aiService.js";

export const generateGeminiResponse = expressAsyncHandler(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) {
    return res.status(400).json({ message: "Prompt is required" });
  }

  const response = await askGemini(prompt.trim());
  return res.status(200).json({
    message: "Gemini response generated successfully",
    response,
  });
});

export const summarizeEmail = expressAsyncHandler(async (req, res) => {
  const { subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) {
    return res.status(400).json({
      message: "Subject and message are required",
    });
  }

  const summary = await summarizeMail(subject.trim(), message.trim());
  return res.status(200).json({
    message: "Mail summarized successfully",
    summary,
  });
});

export const generateReply = expressAsyncHandler(async (req, res) => {
  const { subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) {
    return res.status(400).json({
      message: "Subject and message are required",
    });
  }

  const reply = await generateMailReply(subject.trim(), message.trim());
  return res.status(200).json({
    message: "AI reply generated successfully",
    reply,
  });
});

export const suggestSubject = expressAsyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ message: "Email message is required" });
  }

  const subject = await suggestMailSubject(message.trim());
  return res.status(200).json({
    message: "Email subject suggested successfully",
    subject,
  });
});

export const getImportantPoints = expressAsyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ message: "Email message is required" });
  }

  const importantPoints = await extractImportantPoints(message.trim());
  return res.status(200).json({
    message: "Important points extracted successfully",
    importantPoints,
  });
});
