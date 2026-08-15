import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { triggerImmediateGmailSync } from "../services/gmailImmediateSyncService.js";
import { GmailSyncError } from "../services/gmailSyncService.js";

describe("immediate Gmail synchronization after send", () => {
  test("syncs the sender and only recipients with matching connected Gmail accounts", async () => {
    const lookups = [];
    const syncedUsers = [];
    const summary = await triggerImmediateGmailSync({
      senderUserId: 10,
      recipientEmails: ["connected@gmail.com", "internal@example.com"],
      findConnectedRecipients: async (emails) => {
        lookups.push(emails);
        return [{ userId: 20, gmailEmail: "connected@gmail.com" }];
      },
      syncUser: async ({ userId }) => { syncedUsers.push(userId); },
    });

    assert.deepEqual(lookups, [["connected@gmail.com", "internal@example.com"]]);
    assert.deepEqual(syncedUsers.sort((a, b) => a - b), [10, 20]);
    assert.deepEqual(summary, { requested: 2, synced: 2, skipped: 0, failed: 0 });
  });

  test("uses the existing lease result to skip an overlapping periodic sync", async () => {
    const summary = await triggerImmediateGmailSync({
      senderUserId: 10,
      recipientEmails: [],
      findConnectedRecipients: async () => [],
      syncUser: async () => {
        throw new GmailSyncError("sync_in_progress", "already syncing");
      },
    });

    assert.deepEqual(summary, { requested: 1, synced: 0, skipped: 1, failed: 0 });
  });

  test("never fails an already-sent message when a sync attempt fails", async () => {
    const summary = await triggerImmediateGmailSync({
      senderUserId: 10,
      recipientEmails: ["connected@gmail.com"],
      findConnectedRecipients: async () => [{ userId: 20 }],
      syncUser: async ({ userId }) => {
        if (userId === 20) throw new Error("Gmail history unavailable");
      },
    });

    assert.deepEqual(summary, { requested: 2, synced: 1, skipped: 0, failed: 1 });
  });

  test("still syncs the sender when connected-recipient lookup fails", async () => {
    const syncedUsers = [];
    const summary = await triggerImmediateGmailSync({
      senderUserId: 10,
      recipientEmails: ["connected@gmail.com"],
      findConnectedRecipients: async () => { throw new Error("database unavailable"); },
      syncUser: async ({ userId }) => { syncedUsers.push(userId); },
    });

    assert.deepEqual(syncedUsers, [10]);
    assert.deepEqual(summary, { requested: 1, synced: 1, skipped: 0, failed: 1 });
  });
});
