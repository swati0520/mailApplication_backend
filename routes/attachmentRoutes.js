import express from "express";
import checkToken from "../middleware/CheckToken.js";
import attachmentUpload from "../middleware/attachmentUpload.js";

import {
  uploadAttachment,
  downloadAttachment,
  getAttachment,
  removeAttachment,
} from "../controllers/attachmentControllers.js";

const router = express.Router();

router.post(
  "/upload",
  checkToken,
  attachmentUpload.single("file"),
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

router.get(
  "/:id/download",
  checkToken,
  downloadAttachment
);

export default router;
