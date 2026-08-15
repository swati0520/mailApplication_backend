import { persistGmailChanges } from "../models/GmailMessage.js";
import {
  acquireGmailSyncLease,
  completeGmailSync,
  failGmailSync,
  findGmailSyncStateByConnectionId,
  releaseGmailSyncLease,
} from "../models/GmailSyncState.js";
import { parseGmailMessage } from "../utils/gmailMimeParser.js";
import {
  getAuthenticatedGmailClient,
  GmailConnectionError,
} from "./gmailClientService.js";

export const INITIAL_GMAIL_SYNC_LIMIT = 50;
export const GMAIL_HISTORY_PAGE_SIZE = 500;

export class GmailSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GmailSyncError";
    this.code = code;
  }
}

const getResponseStatus = (error) =>
  Number(error?.response?.status || error?.status || 0);

export const categorizeGmailSyncError = (error) => {
  if (error instanceof GmailConnectionError) return error.code;
  if (error instanceof GmailSyncError) return error.code;
  if (
    [401, 403].includes(getResponseStatus(error)) ||
    error?.code === "invalid_grant" ||
    error?.response?.data?.error === "invalid_grant"
  ) {
    return "gmail_authorization_failed";
  }
  if (getResponseStatus(error) === 429) return "gmail_rate_limited";
  return "sync_failed";
};

const acquireRequiredLease = async (
  gmailConnectionId,
  acquireLease
) => {
  const acquired = await acquireLease(gmailConnectionId);
  if (!acquired) {
    throw new GmailSyncError(
      "sync_in_progress",
      "A Gmail synchronization is already in progress"
    );
  }
};

const runWithGmailSyncLease = async ({
  gmailConnectionId,
  acquireLease,
  markFailed,
  releaseLease,
  operation,
}) => {
  await acquireRequiredLease(gmailConnectionId, acquireLease);

  try {
    return await operation();
  } catch (error) {
    try {
      await markFailed(gmailConnectionId, categorizeGmailSyncError(error));
    } catch {
      // The lease cleanup below is still attempted if status persistence fails.
    }
    throw error;
  } finally {
    try {
      await releaseLease(gmailConnectionId);
    } catch {
      // A database outage may prevent cleanup; the bounded lease still expires.
    }
  }
};

const fetchFullGmailMessage = async ({ gmail, messageId, parseMessage }) => {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "FULL",
  });
  return parseMessage(data);
};

const performBoundedGmailSync = async ({
  gmail,
  gmailConnectionId,
  persistChanges,
  parseMessage,
}) => {
  const [{ data: profile }, { data: listResult }] = await Promise.all([
    gmail.users.getProfile({ userId: "me" }),
    gmail.users.messages.list({
      userId: "me",
      maxResults: INITIAL_GMAIL_SYNC_LIMIT,
      includeSpamTrash: true,
    }),
  ]);
  const messageReferences = listResult.messages || [];
  const messages = [];

  for (const reference of messageReferences) {
    if (!reference?.id) continue;
    messages.push(await fetchFullGmailMessage({
      gmail,
      messageId: reference.id,
      parseMessage,
    }));
  }

  const historyId = profile?.historyId || messages[0]?.historyId || null;
  if (!historyId) {
    throw new GmailSyncError(
      "history_id_missing",
      "Gmail did not return a current history ID"
    );
  }

  await persistChanges({ gmailConnectionId, messages });

  return {
    mode: "initial",
    syncedMessages: messages.length,
    deletedMessages: 0,
    boundedLimit: INITIAL_GMAIL_SYNC_LIMIT,
    nextPageToken: listResult.nextPageToken || null,
    historyId: String(historyId),
  };
};

const addMessageId = (set, entry) => {
  const messageId = entry?.message?.id;
  if (messageId) set.add(messageId);
};

const collectHistoryChanges = (historyRecords, changedIds, deletedIds) => {
  for (const history of historyRecords || []) {
    for (const entry of history.messagesAdded || []) {
      addMessageId(changedIds, entry);
    }
    for (const entry of history.labelsAdded || []) {
      addMessageId(changedIds, entry);
    }
    for (const entry of history.labelsRemoved || []) {
      addMessageId(changedIds, entry);
    }
    for (const entry of history.messagesDeleted || []) {
      addMessageId(deletedIds, entry);
    }
  }
};

const listAllGmailHistory = async ({ gmail, startHistoryId }) => {
  const changedIds = new Set();
  const deletedIds = new Set();
  let pageToken;
  let latestHistoryId = String(startHistoryId);
  let pages = 0;

  do {
    const request = {
      userId: "me",
      startHistoryId: String(startHistoryId),
      maxResults: GMAIL_HISTORY_PAGE_SIZE,
    };
    if (pageToken) request.pageToken = pageToken;

    let data;
    try {
      ({ data } = await gmail.users.history.list(request));
    } catch (error) {
      if (getResponseStatus(error) === 404) {
        throw new GmailSyncError(
          "history_id_invalid",
          "Stored Gmail history ID is invalid or expired"
        );
      }
      throw error;
    }

    pages += 1;
    collectHistoryChanges(data.history, changedIds, deletedIds);
    if (data.historyId) latestHistoryId = String(data.historyId);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return { changedIds, deletedIds, latestHistoryId, pages };
};

const performIncrementalGmailSync = async ({
  gmail,
  gmailConnectionId,
  startHistoryId,
  persistChanges,
  parseMessage,
}) => {
  const { changedIds, deletedIds, latestHistoryId, pages } =
    await listAllGmailHistory({ gmail, startHistoryId });
  const messages = [];

  for (const messageId of changedIds) {
    try {
      messages.push(await fetchFullGmailMessage({
        gmail,
        messageId,
        parseMessage,
      }));
      deletedIds.delete(messageId);
    } catch (error) {
      if (getResponseStatus(error) === 404) {
        deletedIds.add(messageId);
        continue;
      }
      throw error;
    }
  }

  await persistChanges({
    gmailConnectionId,
    messages,
    deletedMessageIds: [...deletedIds],
  });

  return {
    mode: "incremental",
    syncedMessages: messages.length,
    deletedMessages: deletedIds.size,
    historyPages: pages,
    historyId: latestHistoryId,
  };
};

const finalizeSync = async ({ result, gmailConnectionId, markCompleted }) => {
  await markCompleted({
    gmailConnectionId,
    historyId: result.historyId,
  });
  return result;
};

const getSyncDependencies = (overrides) => ({
  getGmailClient: overrides.getGmailClient || getAuthenticatedGmailClient,
  acquireLease: overrides.acquireLease || acquireGmailSyncLease,
  getSyncState:
    overrides.getSyncState || findGmailSyncStateByConnectionId,
  persistChanges:
    overrides.persistChanges ||
    overrides.persistMessages ||
    persistGmailChanges,
  markCompleted: overrides.markCompleted || completeGmailSync,
  markFailed: overrides.markFailed || failGmailSync,
  releaseLease: overrides.releaseLease || releaseGmailSyncLease,
  parseMessage: overrides.parseMessage || parseGmailMessage,
});

export const runInitialGmailSync = async ({ userId, ...overrides }) => {
  const dependencies = getSyncDependencies(overrides);
  const { gmail, gmailConnectionId } =
    await dependencies.getGmailClient({ userId });

  return runWithGmailSyncLease({
    gmailConnectionId,
    acquireLease: dependencies.acquireLease,
    markFailed: dependencies.markFailed,
    releaseLease: dependencies.releaseLease,
    operation: async () => finalizeSync({
      result: await performBoundedGmailSync({
        gmail,
        gmailConnectionId,
        persistChanges: dependencies.persistChanges,
        parseMessage: dependencies.parseMessage,
      }),
      gmailConnectionId,
      markCompleted: dependencies.markCompleted,
    }),
  });
};

export const runGmailSync = async ({ userId, ...overrides }) => {
  const dependencies = getSyncDependencies(overrides);
  const { gmail, gmailConnectionId } =
    await dependencies.getGmailClient({ userId });

  return runWithGmailSyncLease({
    gmailConnectionId,
    acquireLease: dependencies.acquireLease,
    markFailed: dependencies.markFailed,
    releaseLease: dependencies.releaseLease,
    operation: async () => {
      const syncState = await dependencies.getSyncState(gmailConnectionId);
      let result;

      if (!syncState?.history_id) {
        result = await performBoundedGmailSync({
          gmail,
          gmailConnectionId,
          persistChanges: dependencies.persistChanges,
          parseMessage: dependencies.parseMessage,
        });
      } else {
        try {
          result = await performIncrementalGmailSync({
            gmail,
            gmailConnectionId,
            startHistoryId: syncState.history_id,
            persistChanges: dependencies.persistChanges,
            parseMessage: dependencies.parseMessage,
          });
        } catch (error) {
          if (
            !(error instanceof GmailSyncError) ||
            error.code !== "history_id_invalid"
          ) {
            throw error;
          }

          result = await performBoundedGmailSync({
            gmail,
            gmailConnectionId,
            persistChanges: dependencies.persistChanges,
            parseMessage: dependencies.parseMessage,
          });
          result.mode = "fallback";
          result.fallbackReason = "history_id_invalid";
        }
      }

      return finalizeSync({
        result,
        gmailConnectionId,
        markCompleted: dependencies.markCompleted,
      });
    },
  });
};
