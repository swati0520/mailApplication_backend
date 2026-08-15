import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adaptGmailMessage } from "../utils/gmailMessageAdapter.js";
import { parseGmailMessage } from "../utils/gmailMimeParser.js";
import {
  INITIAL_GMAIL_SYNC_LIMIT,
  runInitialGmailSync,
} from "../services/gmailSyncService.js";
import { getAuthenticatedGmailClient } from "../services/gmailClientService.js";
import {
  decodeGmailPageToken,
  encodeGmailPageToken,
} from "../models/GmailMessage.js";

const encode = (value) => Buffer.from(value).toString("base64url");

const gmailFixture = ({ id = "gmail-message-1" } = {}) => ({
  id,
  threadId: "gmail-thread-1",
  historyId: "12345",
  internalDate: "1710000000000",
  labelIds: ["INBOX", "UNREAD", "STARRED", "IMPORTANT"],
  snippet: "Fixture snippet",
  sizeEstimate: 2048,
  payload: {
    partId: "",
    mimeType: "multipart/mixed",
    headers: [
      { name: "Message-ID", value: "<fixture@example.com>" },
      { name: "From", value: 'Example Sender <sender@example.com>' },
      { name: "To", value: 'User One <one@example.com>, two@example.com' },
      { name: "Cc", value: "copy@example.com" },
      { name: "Bcc", value: "hidden@example.com" },
      { name: "Subject", value: "Fixture subject" },
    ],
    parts: [
      {
        partId: "0",
        mimeType: "multipart/alternative",
        parts: [
          {
            partId: "0.1",
            mimeType: "text/plain",
            body: { data: encode("Plain message body") },
          },
          {
            partId: "0.2",
            mimeType: "text/html",
            body: {
              data: encode(
                '<p>Hello <strong>world</strong></p><script>alert("x")</script>'
              ),
            },
          },
        ],
      },
      {
        partId: "1",
        mimeType: "application/pdf",
        filename: "document.pdf",
        body: { attachmentId: "attachment-1", size: 4567 },
      },
    ],
  },
});

describe("Gmail MIME parsing", () => {
  test("parses headers, nested bodies, recipients, and attachment metadata", () => {
    const parsed = parseGmailMessage(gmailFixture());

    assert.equal(parsed.gmailMessageId, "gmail-message-1");
    assert.equal(parsed.gmailThreadId, "gmail-thread-1");
    assert.equal(parsed.rfcMessageId, "<fixture@example.com>");
    assert.equal(parsed.fromEmail, "sender@example.com");
    assert.equal(parsed.fromName, "Example Sender");
    assert.equal(parsed.subject, "Fixture subject");
    assert.equal(parsed.bodyText, "Plain message body");
    assert.match(parsed.bodyHtml, /<strong>world<\/strong>/);
    assert.doesNotMatch(parsed.bodyHtml, /<script/i);
    assert.equal(parsed.recipients.length, 4);
    assert.deepEqual(parsed.attachments, [
      {
        gmailAttachmentId: "attachment-1",
        mimePartId: "1",
        filename: "document.pdf",
        mimeType: "application/pdf",
        size: 4567,
      },
    ]);
  });

  test("uses sanitized HTML text when no plain body exists", () => {
    const fixture = gmailFixture();
    fixture.payload.parts[0].parts.shift();
    const parsed = parseGmailMessage(fixture);

    assert.match(parsed.bodyText, /Hello world/);
    assert.doesNotMatch(parsed.bodyText, /alert/);
  });
});

describe("Gmail response mapping", () => {
  test("derives read-only mailbox state from Gmail labels", () => {
    const adapted = adaptGmailMessage({
      gmail_message_id: "message-1",
      label_ids: JSON.stringify(["SENT", "STARRED", "TRASH"]),
      has_attachment: 1,
    });

    assert.equal(adapted.source, "gmail");
    assert.equal(adapted.is_read, true);
    assert.equal(adapted.is_starred, true);
    assert.equal(adapted.is_important, false);
    assert.equal(adapted.is_archived, false);
    assert.equal(adapted.is_spam, false);
    assert.equal(adapted.is_deleted, true);
    assert.equal(adapted.is_snoozed, false);
    assert.equal(adapted.mailbox_role, "sender");
    assert.equal(adapted.has_attachment, true);
  });

  test("only classifies Gmail messages outside Inbox, Spam, and Trash as archived", () => {
    const archived = adaptGmailMessage({
      gmail_message_id: "archived-message",
      label_ids: JSON.stringify(["SENT", "STARRED"]),
    });
    const spam = adaptGmailMessage({
      gmail_message_id: "spam-message",
      label_ids: JSON.stringify(["SPAM"]),
    });

    assert.equal(archived.is_archived, true);
    assert.equal(spam.is_archived, false);
  });

  test("exposes Gmail To, Cc, and Bcc as display-safe email strings", () => {
    const adapted = adaptGmailMessage({
      gmail_message_id: "message-1",
      label_ids: '["INBOX"]',
      recipients: [
        { recipient_type: "to", email: "to@example.com", display_name: null },
        { recipient_type: "cc", email: "cc@example.com", display_name: "Copy" },
        { recipient_type: "bcc", email: "bcc@example.com", display_name: null },
      ],
    });

    assert.equal(adapted.recipient, "to@example.com");
    assert.equal(adapted.to_email, "to@example.com");
    assert.equal(adapted.cc, "cc@example.com");
    assert.equal(adapted.bcc, "bcc@example.com");
    assert.equal(adapted.recipients[0].email, "to@example.com");
  });

  test("uses an opaque validated cursor instead of page offsets", () => {
    const token = encodeGmailPageToken({
      id: 99,
      internal_date: new Date("2026-08-01T00:00:00Z"),
    });

    assert.deepEqual(decodeGmailPageToken(token), {
      date: new Date("2026-08-01T00:00:00Z"),
      id: "99",
    });
    assert.throws(() => decodeGmailPageToken("not-a-valid-token"), {
      message: "Invalid Gmail page token",
    });
  });
});

describe("Gmail authenticated client", () => {
  test("loads only the authenticated user's connection credentials", async () => {
    let requestedUserId;
    let configuredCredentials;
    const result = await getAuthenticatedGmailClient({
      userId: 42,
      getCredentials: async (userId) => {
        requestedUserId = userId;
        return {
          gmailConnectionId: 9,
          refreshToken: "private-refresh-token",
          connectionStatus: "connected",
          grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        };
      },
      createOAuthClient: () => ({
        setCredentials(credentials) {
          configuredCredentials = credentials;
        },
      }),
      createGmailClient: () => ({ authenticated: true }),
    });

    assert.equal(requestedUserId, 42);
    assert.deepEqual(configuredCredentials, {
      refresh_token: "private-refresh-token",
    });
    assert.deepEqual(result, {
      gmail: { authenticated: true },
      gmailConnectionId: 9,
    });
  });
});

describe("bounded initial Gmail sync", () => {
  test("fetches FULL messages, persists metadata, and returns Gmail pagination", async () => {
    const getCalls = [];
    let listOptions;
    let persisted;
    let completed;
    const fixture = gmailFixture();

    const result = await runInitialGmailSync({
      userId: 42,
      getGmailClient: async () => ({
        gmailConnectionId: 9,
        gmail: {
          users: {
            getProfile: async () => ({ data: { historyId: "12345" } }),
            messages: {
              list: async (options) => {
                listOptions = options;
                return {
                  data: {
                    messages: [{ id: fixture.id }],
                    nextPageToken: "google-next-page",
                  },
                };
              },
              get: async (options) => {
                getCalls.push(options);
                return { data: fixture };
              },
            },
          },
        },
      }),
      acquireLease: async () => true,
      persistMessages: async (value) => {
        persisted = value;
      },
      markCompleted: async (value) => {
        completed = value;
      },
      markFailed: async () => assert.fail("sync should not fail"),
      releaseLease: async () => {},
    });

    assert.deepEqual(listOptions, {
      userId: "me",
      maxResults: INITIAL_GMAIL_SYNC_LIMIT,
      includeSpamTrash: true,
    });
    assert.deepEqual(getCalls, [
      { userId: "me", id: fixture.id, format: "FULL" },
    ]);
    assert.equal(persisted.gmailConnectionId, 9);
    assert.equal(persisted.messages.length, 1);
    assert.equal(persisted.messages[0].attachments.length, 1);
    assert.equal(Object.hasOwn(persisted.messages[0].attachments[0], "data"), false);
    assert.deepEqual(completed, {
      gmailConnectionId: 9,
      historyId: "12345",
    });
    assert.deepEqual(result, {
      mode: "initial",
      syncedMessages: 1,
      deletedMessages: 0,
      boundedLimit: 50,
      nextPageToken: "google-next-page",
      historyId: "12345",
    });
  });

  test("does not mark completion after a failed sync", async () => {
    let completed = false;
    let failedCategory;

    await assert.rejects(
      runInitialGmailSync({
        userId: 42,
        getGmailClient: async () => ({
          gmailConnectionId: 9,
          gmail: {
            users: {
              getProfile: async () => ({ data: { historyId: "12345" } }),
              messages: {
                list: async () => ({
                  data: { messages: [{ id: "message-1" }] },
                }),
                get: async () => {
                  throw new Error("Google request failed");
                },
              },
            },
          },
        }),
        acquireLease: async () => true,
        persistMessages: async () => {},
        markCompleted: async () => {
          completed = true;
        },
        markFailed: async (_connectionId, category) => {
          failedCategory = category;
        },
        releaseLease: async () => {},
      }),
      /Google request failed/
    );

    assert.equal(completed, false);
    assert.equal(failedCategory, "sync_failed");
  });
});
