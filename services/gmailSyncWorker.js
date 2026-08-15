import {
  listConnectedGmailUsers,
  markGmailConnectionError,
} from "../models/GmailConnection.js";
import {
  categorizeGmailSyncError,
  GmailSyncError,
  runGmailSync,
} from "./gmailSyncService.js";

export const DEFAULT_GMAIL_SYNC_INTERVAL_MS = 60 * 1000;
const MINIMUM_GMAIL_SYNC_INTERVAL_MS = 60 * 1000;

export const getGmailSyncIntervalMs = (
  configuredValue = process.env.GMAIL_SYNC_INTERVAL_MS
) => {
  if (configuredValue === undefined || configuredValue === "") {
    return DEFAULT_GMAIL_SYNC_INTERVAL_MS;
  }

  const interval = Number(configuredValue);
  if (!Number.isFinite(interval) || interval < MINIMUM_GMAIL_SYNC_INTERVAL_MS) {
    return DEFAULT_GMAIL_SYNC_INTERVAL_MS;
  }
  return Math.floor(interval);
};

export const runGmailSyncCycle = async ({
  listConnectedUsers = listConnectedGmailUsers,
  syncUser = runGmailSync,
  markConnectionError = markGmailConnectionError,
} = {}) => {
  const users = await listConnectedUsers();

  const summary = {
    connectedUsers: users.length,
    synced: 0,
    skipped: 0,
    failed: 0,
  };

  for (const { userId } of users) {
    try {
      await syncUser({ userId });
      summary.synced += 1;
    } catch (error) {
      if (
        error instanceof GmailSyncError &&
        error.code === "sync_in_progress"
      ) {
        summary.skipped += 1;
        continue;
      }

      const errorCategory = categorizeGmailSyncError(error);
      summary.failed += 1;

      if (errorCategory === "gmail_authorization_failed") {
        try {
          await markConnectionError(userId);
        } catch {
          // Connection error status could not be persisted
        }
      }
    }
  }

  return summary;
};

export const startGmailSyncWorker = ({
  intervalMs = getGmailSyncIntervalMs(),
  runCycle = runGmailSyncCycle,
} = {}) => {
  let isProcessing = false;

  const processGmailSync = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await runCycle();
    } catch {
    } finally {
      isProcessing = false;
    }
  };

  processGmailSync();
  const timer = setInterval(processGmailSync, intervalMs);
  timer.unref();
  return timer;
};
