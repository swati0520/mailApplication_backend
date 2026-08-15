import { findConnectedGmailUsersByEmails } from "../models/GmailConnection.js";
import { GmailSyncError, runGmailSync } from "./gmailSyncService.js";

export const triggerImmediateGmailSync = async ({
  senderUserId,
  recipientEmails = [],
  findConnectedRecipients = findConnectedGmailUsersByEmails,
  syncUser = runGmailSync,
}) => {
  const targetUsers = new Map();
  if (senderUserId !== undefined && senderUserId !== null) {
    targetUsers.set(String(senderUserId), senderUserId);
  }

  let recipientLookupFailed = false;
  try {
    const connectedRecipients = await findConnectedRecipients(recipientEmails);
    for (const recipient of connectedRecipients) {
      if (recipient?.userId !== undefined && recipient?.userId !== null) {
        targetUsers.set(String(recipient.userId), recipient.userId);
      }
    }
  } catch {
    recipientLookupFailed = true;
  }

  const summary = {
    requested: targetUsers.size,
    synced: 0,
    skipped: 0,
    failed: recipientLookupFailed ? 1 : 0,
  };

  await Promise.all([...targetUsers.values()].map(async (userId) => {
    try {
      await syncUser({ userId });
      summary.synced += 1;
    } catch (error) {
      if (error instanceof GmailSyncError && error.code === "sync_in_progress") {
        summary.skipped += 1;
        return;
      }
      summary.failed += 1;
    }
  }));

  return summary;
};
