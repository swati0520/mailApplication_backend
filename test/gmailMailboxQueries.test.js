import assert from "node:assert/strict";
import { describe, test } from "node:test";
import db from "../config/db.js";
import { getGmailMailboxMessagesForUser } from "../models/GmailMessage.js";

const mailboxSqlMarkers = {
  inbox: `JSON_CONTAINS(messages.label_ids, '"INBOX"')`,
  all: `NOT JSON_CONTAINS(messages.label_ids, '"DRAFT"')`,
  sent: `JSON_CONTAINS(messages.label_ids, '"SENT"')`,
  starred: `JSON_CONTAINS(messages.label_ids, '"STARRED"')`,
  spam: `JSON_CONTAINS(messages.label_ids, '"SPAM"')`,
  archived: `NOT JSON_CONTAINS(messages.label_ids, '"INBOX"')`,
  important: `JSON_CONTAINS(messages.label_ids, '"IMPORTANT"')`,
  promotions: `JSON_CONTAINS(messages.label_ids, '"CATEGORY_PROMOTIONS"')`,
};

describe("authenticated cached Gmail mailbox queries", () => {
  test("uses an allowlisted label query scoped to the connected user", async () => {
    const originalQuery = db.query;

    try {
      for (const [mailbox, marker] of Object.entries(mailboxSqlMarkers)) {
        const calls = [];
        db.query = async (sql, params) => {
          calls.push({ sql, params });
          return sql.includes("COUNT(*)")
            ? [[{ totalMails: 1 }]]
            : [[{ gmail_message_id: `${mailbox}-1` }]];
        };

        const result = await getGmailMailboxMessagesForUser(
          42,
          mailbox,
          10,
          20
        );

        assert.equal(result.totalMails, 1);
        assert.equal(result.messages[0].gmail_message_id, `${mailbox}-1`);
        assert.equal(calls.length, 2);
        for (const { sql } of calls) {
          assert.match(sql, /connections\.user_id = \?/);
          assert.match(sql, /connections\.connection_status = 'connected'/);
          assert.match(sql, /messages\.remote_deleted = FALSE/);
          assert.ok(sql.includes(marker), `${mailbox} query must use ${marker}`);
        }
        assert.deepEqual(calls[0].params, [42, 10, 20]);
        assert.deepEqual(calls[1].params, [42]);
      }
    } finally {
      db.query = originalQuery;
    }
  });

  test("rejects unknown mailboxes before querying the database", async () => {
    await assert.rejects(
      getGmailMailboxMessagesForUser(42, "unknown", 10, 0),
      /Invalid Gmail mailbox/
    );
  });
});
