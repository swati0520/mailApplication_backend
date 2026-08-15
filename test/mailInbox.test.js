import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptGmailInboxMessage,
  getCombinedInbox,
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
