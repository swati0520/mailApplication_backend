import express from "express";
import checkToken from "../middleware/CheckToken.js";
import upload from "../middleware/upload.js";

import {
  uploadAttachment,
  getAttachment,
  removeAttachment,
} from "../controllers/attachmentControllers.js";

const router = express.Router();

router.post(
  "/upload",
  checkToken,
  upload.single("file"),
  uploadAttachment
);

router.get(
  "/",
  checkToken,
  getAttachment
);

router.delete(
  "/:id",
  checkToken,
  removeAttachment
);

export default router;