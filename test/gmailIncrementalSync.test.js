import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GMAIL_HISTORY_PAGE_SIZE,
  GmailSyncError,
  runGmailSync,
} from "../services/gmailSyncService.js";
import {
  DEFAULT_GMAIL_SYNC_INTERVAL_MS,
  getGmailSyncIntervalMs,
  runGmailSyncCycle,
} from "../services/gmailSyncWorker.js";

const cachedMessage = (id, labelIds) => ({
  gmailMessageId: id,
  gmailThreadId: `thread-${id}`,
  rfcMessageId: `<${id}@example.com>`,
  historyId: "200",
  internalDate: new Date("2026-08-13T10:00:00Z"),
  fromEmail: "sender@example.com",
  fromName: "Sender",
  subject: id,
  snippet: id,
  bodyText: id,
  bodyHtml: null,
  labelIds,
  mimeType: "text/plain",
  sizeEstimate: 100,
  hasAttachment: false,
  recipients: [],
  attachments: [],
});

const historyEntry = (id) => ({ message: { id } });

const baseDependencies = ({ gmail, overrides = {} }) => ({
  userId: 42,
  getGmailClient: async () => ({ gmailConnectionId: 9, gmail }),
  acquireLease: async () => true,
  getSyncState: async () => ({ history_id: "100" }),
  persistChanges: async () => {},
  markCompleted: async () => {},
  markFailed: async () => {},
  releaseLease: async () => {},
  parseMessage: (message) => message,
  ...overrides,
});

describe("incremental Gmail synchronization", () => {
  test("uses stored historyId, processes every page, and upserts each changed message once", async () => {
    const historyCalls = [];
    const messageGets = [];
    let persisted;
    let completed;
    const messages = new Map([
      ["inbox-message", cachedMessage("inbox-message", ["INBOX", "UNREAD"])],
      ["spam-message", cachedMessage("spam-message", ["SPAM"])],
      ["trash-message", cachedMessage("trash-message", ["TRASH"])],
      ["left-inbox", cachedMessage("left-inbox", ["IMPORTANT"])],
    ]);
    const gmail = {
      users: {
        history: {
          list: async (request) => {
            historyCalls.push(request);
            if (!request.pageToken) {
              return {
                data: {
                  historyId: "180",
                  nextPageToken: "page-2",
                  history: [{
                    messagesAdded: [
                      historyEntry("inbox-message"),
                      historyEntry("spam-message"),
                    ],
                    labelsAdded: [historyEntry("inbox-message")],
                  }],
                },
              };
            }
            return {
              data: {
                historyId: "200",
                history: [{
                  messagesAdded: [historyEntry("trash-message")],
                  labelsRemoved: [historyEntry("left-inbox")],
                  messagesDeleted: [historyEntry("deleted-message")],
                }],
              },
            };
          },
        },
        messages: {
          get: async ({ id }) => {
            messageGets.push(id);
            return { data: messages.get(id) };
          },
        },
      },
    };

    const result = await runGmailSync(baseDependencies({
      gmail,
      overrides: {
        persistChanges: async (changes) => { persisted = changes; },
        markCompleted: async (value) => { completed = value; },
      },
    }));

    assert.deepEqual(historyCalls, [
      {
        userId: "me",
        startHistoryId: "100",
        maxResults: GMAIL_HISTORY_PAGE_SIZE,
      },
      {
        userId: "me",
        startHistoryId: "100",
        maxResults: GMAIL_HISTORY_PAGE_SIZE,
        pageToken: "page-2",
      },
    ]);
    assert.deepEqual(messageGets, [
      "inbox-message",
      "spam-message",
      "trash-message",
      "left-inbox",
    ]);
    assert.equal(new Set(messageGets).size, messageGets.length);
    assert.deepEqual(persisted.deletedMessageIds, ["deleted-message"]);
    assert.deepEqual(
      persisted.messages.map(({ gmailMessageId, labelIds }) => ({
        gmailMessageId,
        labelIds,
      })),
      [
        { gmailMessageId: "inbox-message", labelIds: ["INBOX", "UNREAD"] },
        { gmailMessageId: "spam-message", labelIds: ["SPAM"] },
        { gmailMessageId: "trash-message", labelIds: ["TRASH"] },
        { gmailMessageId: "left-inbox", labelIds: ["IMPORTANT"] },
      ]
    );

    const unifiedInboxMessages = persisted.messages.filter(({ labelIds }) =>
      labelIds.includes("INBOX") &&
      !labelIds.includes("SPAM") &&
      !labelIds.includes("TRASH")
    );
    assert.deepEqual(
      unifiedInboxMessages.map((message) => message.gmailMessageId),
      ["inbox-message"]
    );
    assert.deepEqual(completed, {
      gmailConnectionId: 9,
      historyId: "200",
    });
    assert.deepEqual(result, {
      mode: "incremental",
      syncedMessages: 4,
      deletedMessages: 1,
      historyPages: 2,
      historyId: "200",
    });
  });

  test("treats a changed message that now returns 404 as remotely deleted", async () => {
    let persisted;
    const gmail = {
      users: {
        history: {
          list: async () => ({
            data: {
              historyId: "101",
              history: [{ labelsRemoved: [historyEntry("gone")] }],
            },
          }),
        },
        messages: {
          get: async () => {
            const error = new Error("not found");
            error.response = { status: 404 };
            throw error;
          },
        },
      },
    };

    await runGmailSync(baseDependencies({
      gmail,
      overrides: {
        persistChanges: async (changes) => { persisted = changes; },
      },
    }));

    assert.deepEqual(persisted.messages, []);
    assert.deepEqual(persisted.deletedMessageIds, ["gone"]);
  });

  test("falls back to the bounded sync when historyId is invalid", async () => {
    const getCalls = [];
    let persisted;
    let completed;
    const fallbackMessage = cachedMessage("fallback-message", ["INBOX"]);
    const gmail = {
      users: {
        getProfile: async () => ({ data: { historyId: "500" } }),
        history: {
          list: async () => {
            const error = new Error("history expired");
            error.response = { status: 404 };
            throw error;
          },
        },
        messages: {
          list: async () => ({
            data: { messages: [{ id: "fallback-message" }] },
          }),
          get: async ({ id }) => {
            getCalls.push(id);
            return { data: fallbackMessage };
          },
        },
      },
    };

    const result = await runGmailSync(baseDependencies({
      gmail,
      overrides: {
        persistChanges: async (changes) => { persisted = changes; },
        markCompleted: async (value) => { completed = value; },
      },
    }));

    assert.deepEqual(getCalls, ["fallback-message"]);
    assert.equal(persisted.messages.length, 1);
    assert.deepEqual(completed, {
      gmailConnectionId: 9,
      historyId: "500",
    });
    assert.equal(result.mode, "fallback");
    assert.equal(result.fallbackReason, "history_id_invalid");
    assert.equal(result.boundedLimit, 50);
  });

  test("does not enter the sync or release another owner's lease when lock acquisition fails", async () => {
    let stateRead = false;
    let released = false;
    const gmail = { users: {} };

    await assert.rejects(
      runGmailSync(baseDependencies({
        gmail,
        overrides: {
          acquireLease: async () => false,
          getSyncState: async () => { stateRead = true; },
          releaseLease: async () => { released = true; },
        },
      })),
      (error) =>
        error instanceof GmailSyncError && error.code === "sync_in_progress"
    );

    assert.equal(stateRead, false);
    assert.equal(released, false);
  });

  test("releases the lease after success", async () => {
    let releasedConnectionId;
    const gmail = {
      users: {
        history: {
          list: async () => ({ data: { historyId: "101" } }),
        },
        messages: { get: async () => assert.fail("no message fetch expected") },
      },
    };

    await runGmailSync(baseDependencies({
      gmail,
      overrides: {
        releaseLease: async (connectionId) => {
          releasedConnectionId = connectionId;
        },
      },
    }));

    assert.equal(releasedConnectionId, 9);
  });

  test("database failure does not advance history and still releases the lease", async () => {
    let completed = false;
    let failedCategory;
    let released = false;
    const gmail = {
      users: {
        history: {
          list: async () => ({ data: { historyId: "101" } }),
        },
        messages: { get: async () => assert.fail("no message fetch expected") },
      },
    };

    await assert.rejects(
      runGmailSync(baseDependencies({
        gmail,
        overrides: {
          persistChanges: async () => { throw new Error("database failed"); },
          markCompleted: async () => { completed = true; },
          markFailed: async (_connectionId, category) => {
            failedCategory = category;
          },
          releaseLease: async () => { released = true; },
        },
      })),
      /database failed/
    );

    assert.equal(completed, false);
    assert.equal(failedCategory, "sync_failed");
    assert.equal(released, true);
  });

  test("still attempts lease cleanup when failure-state persistence fails", async () => {
    let released = false;
    const gmail = {
      users: {
        history: { list: async () => { throw new Error("network failed"); } },
        messages: {},
      },
    };

    await assert.rejects(
      runGmailSync(baseDependencies({
        gmail,
        overrides: {
          markFailed: async () => { throw new Error("database failed"); },
          releaseLease: async () => { released = true; },
        },
      })),
      /network failed/
    );
    assert.equal(released, true);
  });

  test("uses the bounded initial path when no stored historyId exists", async () => {
    let persisted;
    const gmail = {
      users: {
        getProfile: async () => ({ data: { historyId: "300" } }),
        messages: {
          list: async () => ({ data: { messages: [] } }),
          get: async () => assert.fail("no message fetch expected"),
        },
      },
    };

    const result = await runGmailSync(baseDependencies({
      gmail,
      overrides: {
        getSyncState: async () => undefined,
        persistChanges: async (changes) => { persisted = changes; },
      },
    }));

    assert.equal(result.mode, "initial");
    assert.equal(result.historyId, "300");
    assert.deepEqual(persisted.messages, []);
  });

  test("a repeated history result remains idempotent at the Gmail message identity", async () => {
    const cache = new Map();
    const message = cachedMessage("same-message", ["INBOX"]);
    const gmail = {
      users: {
        history: {
          list: async () => ({
            data: {
              historyId: "101",
              history: [{ messagesAdded: [historyEntry("same-message")] }],
            },
          }),
        },
        messages: { get: async () => ({ data: message }) },
      },
    };
    const persistChanges = async ({ messages }) => {
      for (const value of messages) cache.set(value.gmailMessageId, value);
    };
    const dependencies = baseDependencies({
      gmail,
      overrides: { persistChanges },
    });

    await runGmailSync(dependencies);
    await runGmailSync(dependencies);

    assert.equal(cache.size, 1);
    assert.equal(cache.get("same-message").subject, "same-message");
  });

  test("malformed Gmail data fails safely without advancing history", async () => {
    let completed = false;
    let failedCategory;
    let released = false;
    const gmail = {
      users: {
        history: {
          list: async () => ({
            data: {
              historyId: "101",
              history: [{ messagesAdded: [historyEntry("malformed")] }],
            },
          }),
        },
        messages: { get: async () => ({ data: { id: "malformed" } }) },
      },
    };

    await assert.rejects(
      runGmailSync(baseDependencies({
        gmail,
        overrides: {
          parseMessage: () => { throw new Error("Invalid Gmail message payload"); },
          markCompleted: async () => { completed = true; },
          markFailed: async (_connectionId, category) => {
            failedCategory = category;
          },
          releaseLease: async () => { released = true; },
        },
      })),
      /Invalid Gmail message payload/
    );

    assert.equal(completed, false);
    assert.equal(failedCategory, "sync_failed");
    assert.equal(released, true);
  });

  test("Gmail authorization failure is categorized and releases the lease", async () => {
    let failedCategory;
    let released = false;
    const authorizationError = new Error("unauthorized");
    authorizationError.response = { status: 401 };
    const gmail = {
      users: {
        history: { list: async () => { throw authorizationError; } },
        messages: {},
      },
    };

    await assert.rejects(
      runGmailSync(baseDependencies({
        gmail,
        overrides: {
          markFailed: async (_connectionId, category) => {
            failedCategory = category;
          },
          releaseLease: async () => { released = true; },
        },
      })),
      /unauthorized/
    );

    assert.equal(failedCategory, "gmail_authorization_failed");
    assert.equal(released, true);
  });
});

describe("automatic Gmail synchronization worker", () => {
  test("isolates one user's failure and continues with the next connected user", async () => {
    const attempted = [];
    const summary = await runGmailSyncCycle({
      listConnectedUsers: async () => [{ userId: 1 }, { userId: 2 }],
      syncUser: async ({ userId }) => {
        attempted.push(userId);
        if (userId === 1) throw new Error("network failure");
        return { mode: "incremental", syncedMessages: 1 };
      },
    });

    assert.deepEqual(attempted, [1, 2]);
    assert.deepEqual(summary, {
      connectedUsers: 2,
      synced: 1,
      skipped: 0,
      failed: 1,
    });
  });

  test("skips locked accounts and only receives connected users from its loader", async () => {
    const attempted = [];
    const summary = await runGmailSyncCycle({
      listConnectedUsers: async () => [{ userId: 2 }],
      syncUser: async ({ userId }) => {
        attempted.push(userId);
        throw new GmailSyncError("sync_in_progress", "already syncing");
      },
      logger: { info() {}, error() {} },
    });

    assert.deepEqual(attempted, [2]);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.failed, 0);
  });

  test("marks an invalid refresh-token connection as error without exposing tokens", async () => {
    let markedUserId;
    const tokenError = new Error("token refresh failed");
    tokenError.response = { status: 400, data: { error: "invalid_grant" } };

    const summary = await runGmailSyncCycle({
      listConnectedUsers: async () => [{ userId: 7 }],
      syncUser: async () => { throw tokenError; },
      markConnectionError: async (userId) => { markedUserId = userId; },
    });

    assert.equal(markedUserId, 7);
    assert.equal(summary.failed, 1);
  });

  test("uses a safe configurable interval", () => {
    assert.equal(getGmailSyncIntervalMs(undefined), DEFAULT_GMAIL_SYNC_INTERVAL_MS);
    assert.equal(getGmailSyncIntervalMs("60000"), 60000);
    assert.equal(getGmailSyncIntervalMs("1000"), DEFAULT_GMAIL_SYNC_INTERVAL_MS);
    assert.equal(getGmailSyncIntervalMs("invalid"), DEFAULT_GMAIL_SYNC_INTERVAL_MS);
  });
});
