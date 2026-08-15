import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptGmailInboxMessage,
  getCombinedAllMail,
  getCombinedInbox,
  getCombinedSent,
  getCombinedStateMailbox,
  getGmailPromotionsMailbox,
  parseGmailSourceMessageId,
} from "../services/mailInboxService.js";

describe("combined existing Inbox", () => {
  test("maps Gmail messages to source-qualified identities", () => {
    const message = adaptGmailInboxMessage({
      gmail_message_id: "gmail-message-1",
      label_ids: JSON.stringify(["INBOX", "UNREAD"]),
      internal_date: new Date("2026-08-13T10:00:00Z"),
    });

    assert.equal(message.id, "gmail:gmail-message-1");
    assert.equal(message.source, "gmail");
    assert.equal(message.sourceMessageId, "gmail-message-1");
    assert.equal(message.is_read, false);
    assert.equal(parseGmailSourceMessageId(message.id), "gmail-message-1");
    assert.equal(parseGmailSourceMessageId("42"), null);
  });

  test("merges sources by date and preserves existing page pagination", async () => {
    const internalCalls = [];
    const gmailCalls = [];
    const result = await getCombinedInbox({
      userId: 42,
      page: 2,
      limit: 2,
      getInternalInbox: async (...args) => {
        internalCalls.push(args);
        return {
          totalMails: 3,
          mails: [
            { id: 3, created_at: "2026-08-13T12:00:00Z" },
            { id: 2, created_at: "2026-08-13T10:00:00Z" },
            { id: 1, created_at: "2026-08-13T08:00:00Z" },
          ],
        };
      },
      getGmailInbox: async (...args) => {
        gmailCalls.push(args);
        return {
          totalMails: 2,
          messages: [
            {
              gmail_message_id: "g-2",
              internal_date: "2026-08-13T11:00:00Z",
              label_ids: '["INBOX"]',
            },
            {
              gmail_message_id: "g-1",
              internal_date: "2026-08-13T09:00:00Z",
              label_ids: '["INBOX"]',
            },
          ],
        };
      },
    });

    assert.deepEqual(internalCalls, [[42, 4, 0]]);
    assert.deepEqual(gmailCalls, [[42, 4, 0]]);
    assert.equal(result.totalMails, 5);
    assert.deepEqual(
      result.mails.map(({ id, source }) => ({ id, source })),
      [
        { id: 2, source: "internal" },
        { id: "gmail:g-1", source: "gmail" },
      ]
    );
  });
});

describe("combined Sent mailbox", () => {
  test("includes the authenticated user's synced Gmail replies with internal sent mail", async () => {
    const result = await getCombinedSent({
      userId: 42,
      page: 1,
      limit: 10,
      getInternalSent: async (userId, limit, offset) => {
        assert.deepEqual([userId, limit, offset], [42, 10, 0]);
        return {
          totalMails: 1,
          mails: [{ id: 7, created_at: "2026-08-15T09:00:00Z", mailbox_role: "sender" }],
        };
      },
      getGmailSent: async (userId, limit, offset) => {
        assert.deepEqual([userId, limit, offset], [42, 10, 0]);
        return {
          totalMails: 1,
          messages: [{
            gmail_message_id: "gmail-reply-1",
            internal_date: "2026-08-15T10:00:00Z",
            label_ids: '["SENT"]',
          }],
        };
      },
    });

    assert.equal(result.totalMails, 2);
    assert.deepEqual(
      result.mails.map(({ id, source, mailbox_role: mailboxRole }) => ({
        id,
        source,
        mailboxRole,
      })),
      [
        { id: "gmail:gmail-reply-1", source: "gmail", mailboxRole: "sender" },
        { id: 7, source: "internal", mailboxRole: "sender" },
      ]
    );
  });
});

describe("combined Gmail mailbox sections", () => {
  test("All Mail merges internal and Gmail cache results", async () => {
    const result = await getCombinedAllMail({
      userId: 42,
      page: 1,
      limit: 10,
      getInternalAll: async () => ({
        totalMails: 1,
        mails: [{ id: 8, created_at: "2026-08-15T09:00:00Z" }],
      }),
      getGmailAll: async () => ({
        totalMails: 1,
        messages: [{
          gmail_message_id: "gmail-all-1",
          internal_date: "2026-08-15T10:00:00Z",
          label_ids: '["INBOX"]',
        }],
      }),
    });

    assert.equal(result.totalMails, 2);
    assert.deepEqual(result.mails.map(({ id }) => id), ["gmail:gmail-all-1", 8]);
  });

  test("state folders pass separate internal state and Gmail mailbox filters", async () => {
    const internalCalls = [];
    const gmailCalls = [];
    const result = await getCombinedStateMailbox({
      userId: 42,
      page: 1,
      limit: 10,
      stateField: "is_starred",
      gmailMailbox: "starred",
      getInternalState: async (...args) => {
        internalCalls.push(args);
        return { totalMails: 0, mails: [] };
      },
      getGmailState: async (...args) => {
        gmailCalls.push(args);
        return {
          totalMails: 1,
          messages: [{
            gmail_message_id: "gmail-starred-1",
            internal_date: "2026-08-15T10:00:00Z",
            label_ids: '["STARRED"]',
          }],
        };
      },
    });

    assert.deepEqual(internalCalls, [[42, "is_starred", 10, 0]]);
    assert.deepEqual(gmailCalls, [[42, "starred", 10, 0]]);
    assert.equal(result.mails[0].id, "gmail:gmail-starred-1");
  });

  test("Promotions is Gmail-only and source-qualified", async () => {
    const calls = [];
    const result = await getGmailPromotionsMailbox({
      userId: 42,
      page: 1,
      limit: 10,
      getGmailPromotions: async (...args) => {
        calls.push(args);
        return {
          totalMails: 1,
          messages: [{
            gmail_message_id: "promotion-1",
            internal_date: "2026-08-15T10:00:00Z",
            label_ids: '["CATEGORY_PROMOTIONS"]',
          }],
        };
      },
    });

    assert.deepEqual(calls, [[42, "promotions", 10, 0]]);
    assert.equal(result.totalMails, 1);
    assert.equal(result.mails[0].source, "gmail");
  });
});
