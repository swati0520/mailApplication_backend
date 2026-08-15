import expressAsyncHandler from "express-async-handler";
import {
  findGmailMessageForUser,
  listGmailMessagesForUser,
} from "../models/GmailMessage.js";
import { findGmailSyncStatusForUser } from "../models/GmailSyncState.js";
import { adaptGmailMessage } from "../utils/gmailMessageAdapter.js";
import {
  GmailSyncError,
  runGmailSync,
} from "../services/gmailSyncService.js";
import { triggerImmediateGmailSync } from "../services/gmailImmediateSyncService.js";
import { GmailConnectionError } from "../services/gmailClientService.js";
import {
  buildInlineContentDisposition,
  getGmailAttachmentContent,
  GmailAttachmentError,
} from "../services/gmailAttachmentService.js";
import {
  archiveGmailMessage,
  forwardGmailMessage,
  GmailMessageActionError,
  markGmailMessageImportant,
  markGmailMessageNotSpam,
  markGmailMessageRead,
  markGmailMessageSpam,
  markGmailMessageUnimportant,
  markGmailMessageUnread,
  replyAllToGmailMessage,
  replyToGmailMessage,
  starGmailMessage,
  trashGmailMessage,
  unarchiveGmailMessage,
  unstarGmailMessage,
} from "../services/gmailMessageActionService.js";

const GMAIL_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

const getLimit = (req) =>
  Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

const getValidatedGmailMessageId = (req, res) => {
  const gmailMessageId = req.params.gmailMessageId;
  if (!GMAIL_MESSAGE_ID_PATTERN.test(gmailMessageId)) {
    res.status(400).json({ message: "Invalid Gmail message ID" });
    return null;
  }
  return gmailMessageId;
};

const handleGmailActionError = (error, res) => {
  if (error instanceof GmailConnectionError) {
    return res.status(409).json({
      code: error.code,
      message: error.message,
      reconnectRequired: error.code === "gmail_scope_missing",
    });
  }
  if (error instanceof GmailMessageActionError) {
    return res.status(error.statusCode).json({
      code: error.code,
      message: error.message,
    });
  }
  throw error;
};

export const createGetGmailAttachmentController = ({
  getAttachment = getGmailAttachmentContent,
} = {}) => expressAsyncHandler(async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const attachment = await getAttachment({
      gmailMessageId: req.params.gmailMessageId,
      gmailAttachmentId: req.params.gmailAttachmentId,
      userId: req.user.id,
    });
    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader(
      "Content-Disposition",
      buildInlineContentDisposition(attachment.filename)
    );
    res.setHeader("Content-Length", attachment.buffer.length);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(attachment.buffer);
  } catch (error) {
    if (error instanceof GmailConnectionError) {
      return res.status(409).json({
        code: error.code,
        message: error.message,
        reconnectRequired: true,
      });
    }
    if (error instanceof GmailAttachmentError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
});

export const getGmailAttachment = createGetGmailAttachmentController();

export const listCachedGmailMessages = expressAsyncHandler(async (req, res) => {
  let result;
  try {
    result = await listGmailMessagesForUser({
      userId: req.user.id,
      limit: getLimit(req),
      pageToken: req.query.pageToken,
    });
  } catch (error) {
    if (error.message === "Invalid Gmail page token") {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }

  return res.status(200).json({
    messages: result.messages.map(adaptGmailMessage),
    nextPageToken: result.nextPageToken,
  });
});

export const getCachedGmailMessage = expressAsyncHandler(async (req, res) => {
  const gmailMessageId = getValidatedGmailMessageId(req, res);
  if (!gmailMessageId) return;

  const message = await findGmailMessageForUser(
    gmailMessageId,
    req.user.id
  );

  if (!message) {
    return res.status(404).json({ message: "Gmail message not found" });
  }

  return res.status(200).json({ message: adaptGmailMessage(message) });
});

export const deleteGmailMessage = expressAsyncHandler(async (req, res) => {
  const gmailMessageId = getValidatedGmailMessageId(req, res);
  if (!gmailMessageId) return;
  try {
    await trashGmailMessage({ gmailMessageId, userId: req.user.id });
    return res.status(200).json({ message: "Gmail message moved to trash" });
  } catch (error) {
    return handleGmailActionError(error, res);
  }
});

const gmailLabelAction = (action, successMessage) =>
  expressAsyncHandler(async (req, res) => {
    const gmailMessageId = getValidatedGmailMessageId(req, res);
    if (!gmailMessageId) return;
    try {
      const result = await action({ gmailMessageId, userId: req.user.id });
      return res.status(200).json({ message: successMessage, ...result });
    } catch (error) {
      return handleGmailActionError(error, res);
    }
  });

export const archiveGmailMessageController = gmailLabelAction(
  archiveGmailMessage,
  "Gmail message archived"
);
export const unarchiveGmailMessageController = gmailLabelAction(
  unarchiveGmailMessage,
  "Gmail message restored to inbox"
);
export const readGmailMessage = gmailLabelAction(
  markGmailMessageRead,
  "Gmail message marked as read"
);
export const unreadGmailMessage = gmailLabelAction(
  markGmailMessageUnread,
  "Gmail message marked as unread"
);
export const starGmailMessageController = gmailLabelAction(
  starGmailMessage,
  "Gmail message starred"
);
export const unstarGmailMessageController = gmailLabelAction(
  unstarGmailMessage,
  "Gmail message unstarred"
);
export const importantGmailMessage = gmailLabelAction(
  markGmailMessageImportant,
  "Gmail message marked as important"
);
export const unimportantGmailMessage = gmailLabelAction(
  markGmailMessageUnimportant,
  "Gmail message marked as unimportant"
);
export const spamGmailMessage = gmailLabelAction(
  markGmailMessageSpam,
  "Gmail message moved to spam"
);
export const unspamGmailMessage = gmailLabelAction(
  markGmailMessageNotSpam,
  "Gmail message removed from spam"
);

export const replyGmailMessage = expressAsyncHandler(async (req, res) => {
  const gmailMessageId = getValidatedGmailMessageId(req, res);
  if (!gmailMessageId) return;
  try {
    const result = await replyToGmailMessage({
      gmailMessageId,
      userId: req.user.id,
      body: req.body.body,
      onSent: triggerImmediateGmailSync,
    });
    return res.status(201).json({ message: "Gmail reply sent successfully", ...result });
  } catch (error) {
    return handleGmailActionError(error, res);
  }
});

export const replyAllGmailMessage = expressAsyncHandler(async (req, res) => {
  const gmailMessageId = getValidatedGmailMessageId(req, res);
  if (!gmailMessageId) return;
  try {
    const result = await replyAllToGmailMessage({
      gmailMessageId,
      userId: req.user.id,
      body: req.body.body,
      onSent: triggerImmediateGmailSync,
    });
    return res.status(201).json({ message: "Gmail Reply All sent successfully", ...result });
  } catch (error) {
    return handleGmailActionError(error, res);
  }
});

export const forwardGmailMessageController = expressAsyncHandler(async (req, res) => {
  const gmailMessageId = getValidatedGmailMessageId(req, res);
  if (!gmailMessageId) return;
  try {
    const result = await forwardGmailMessage({
      gmailMessageId,
      userId: req.user.id,
      to: req.body.to,
      body: req.body.body,
      onSent: triggerImmediateGmailSync,
    });
    return res.status(201).json({ message: "Gmail message forwarded successfully", ...result });
  } catch (error) {
    return handleGmailActionError(error, res);
  }
});

export const syncGmailMessages = expressAsyncHandler(async (req, res) => {
  try {
    const result = await runGmailSync({ userId: req.user.id });
    return res.status(200).json({
      message: "Gmail synchronization completed",
      ...result,
    });
  } catch (error) {
    if (error instanceof GmailSyncError && error.code === "sync_in_progress") {
      return res.status(409).json({ message: error.message });
    }
    if (error instanceof GmailConnectionError) {
      return res.status(409).json({ message: error.message });
    }
    throw error;
  }
});

export const getGmailSyncStatus = expressAsyncHandler(async (req, res) => {
  const status = await findGmailSyncStatusForUser(req.user.id);

  if (!status) {
    return res.status(404).json({ message: "Connected Gmail account not found" });
  }

  return res.status(200).json({
    status: status.sync_status || "idle",
    initialSyncCompletedAt: status.initial_sync_completed_at || null,
    lastSyncStartedAt: status.last_sync_started_at || null,
    lastSyncCompletedAt: status.last_sync_completed_at || null,
    errorCategory: status.error_category || null,
  });
});
