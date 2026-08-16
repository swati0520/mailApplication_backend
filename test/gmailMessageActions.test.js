import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
} from "../config/gmailOAuth.js";
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
  persistSentGmailReply,
  replyAllToGmailMessage,
  replyToGmailMessage,
  starGmailMessage,
  trashGmailMessage,
  unarchiveGmailMessage,
  unstarGmailMessage,
} from "../services/gmailMessageActionService.js";

const originalMessage = {
  id: 10,
  gmail_connection_id: 9,
  gmail_message_id: "18f_example-message",
  gmail_thread_id: "18f_example-thread",
  rfc_message_id: "<original@example.com>",
  from_email: "sender@example.com",
  subject: "Project update",
  body_text: "Original message body",
  snippet: "Original message body",
  internal_date: new Date("2026-08-13T10:00:00Z"),
  label_ids: JSON.stringify(["INBOX", "UNREAD"]),
  recipients: [
    { recipient_type: "to", email: "owner@gmail.com" },
    { recipient_type: "to", email: "teammate@example.com" },
    { recipient_type: "cc", email: "observer@example.com" },
  ],
};

const createGmail = () => {
  const calls = { get: [], modify: [], trash: [], send: [] };
  const gmail = {
    users: {
      messages: {
        get: async (request) => {
          calls.get.push(request);
          return {
            data: {
              id: originalMessage.gmail_message_id,
              threadId: originalMessage.gmail_thread_id,
            },
          };
        },
        trash: async (request) => {
          calls.trash.push(request);
          return { data: { id: request.id, labelIds: ["TRASH"] } };
        },
        modify: async (request) => {
          calls.modify.push(request);
          const removed = new Set(request.requestBody.removeLabelIds);
          return {
            data: {
              id: request.id,
              labelIds: [
                ...JSON.parse(originalMessage.label_ids).filter((label) => !removed.has(label)),
                ...request.requestBody.addLabelIds,
              ],
            },
          };
        },
        send: async (request) => {
          calls.send.push(request);
          return {
            data: {
              id: "sent-message",
              threadId: request.requestBody.threadId || "forward-thread",
            },
          };
        },
      },
    },
  };
  return { gmail, calls };
};

const decodeRaw = (raw) => Buffer.from(raw, "base64url").toString("utf8");

const decodeMimePart = (mime, contentType) => {
  const marker = `Content-Type: ${contentType}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
  const start = mime.indexOf(marker);
  assert.notEqual(start, -1);
  const bodyStart = start + marker.length;
  const bodyEnd = mime.indexOf("\r\n--", bodyStart);
  return Buffer.from(
    mime.slice(bodyStart, bodyEnd).replace(/\r\n/g, ""),
    "base64"
  ).toString("utf8");
};

describe("Gmail message actions", () => {
  test("rejects a cached message from a different Gmail connection", async () => {
    const { gmail, calls } = createGmail();
    await assert.rejects(
      trashGmailMessage({
        gmailMessageId: originalMessage.gmail_message_id,
        userId: 42,
        findMessage: async () => originalMessage,
        getGmailClient: async () => ({
          gmail,
          gmailConnectionId: 99,
          gmailEmail: "owner@gmail.com",
        }),
        markTrashed: async () => {},
      }),
      (error) =>
        error instanceof GmailMessageActionError &&
        error.code === "gmail_message_mismatch"
    );
    assert.equal(calls.get.length, 0);
    assert.equal(calls.trash.length, 0);
  });

  test("trashes the authenticated user's real Gmail message and updates cached labels", async () => {
    const { gmail, calls } = createGmail();
    let requiredScopes;
    let marked;

    await trashGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      findMessage: async (messageId, userId) => {
        assert.equal(messageId, originalMessage.gmail_message_id);
        assert.equal(userId, 42);
        return originalMessage;
      },
      getGmailClient: async (options) => {
        requiredScopes = options.requiredScopes;
        return { gmail, gmailConnectionId: 9, gmailEmail: "owner@gmail.com" };
      },
      markTrashed: async (value) => { marked = value; },
    });

    assert.deepEqual(requiredScopes, [GMAIL_MODIFY_SCOPE]);
    assert.deepEqual(calls.trash, [
      { userId: "me", id: originalMessage.gmail_message_id },
    ]);
    assert.deepEqual(marked.labelIds.sort(), ["TRASH", "UNREAD"]);
  });

  const labelActions = [
    ["archive", archiveGmailMessage, [], ["INBOX", "SPAM"], ["UNREAD"]],
    ["unarchive", unarchiveGmailMessage, ["INBOX"], [], ["INBOX", "UNREAD"]],
    ["read", markGmailMessageRead, [], ["UNREAD"], ["INBOX"]],
    ["unread", markGmailMessageUnread, ["UNREAD"], [], ["INBOX", "UNREAD"]],
    ["star", starGmailMessage, ["STARRED"], [], ["INBOX", "STARRED", "UNREAD"]],
    ["unstar", unstarGmailMessage, [], ["STARRED"], ["INBOX", "UNREAD"]],
    ["important", markGmailMessageImportant, ["IMPORTANT"], [], ["IMPORTANT", "INBOX", "UNREAD"]],
    ["unimportant", markGmailMessageUnimportant, [], ["IMPORTANT"], ["INBOX", "UNREAD"]],
    ["spam", markGmailMessageSpam, ["SPAM"], ["INBOX"], ["SPAM", "UNREAD"]],
    ["unspam", markGmailMessageNotSpam, ["INBOX"], ["SPAM"], ["INBOX", "UNREAD"]],
  ];

  for (const [name, action, addLabelIds, removeLabelIds, expectedLabels] of labelActions) {
    test(`${name} modifies Gmail labels and updates the user-scoped cache`, async () => {
      const { gmail, calls } = createGmail();
      let updated;
      let requiredScopes;

      await action({
        gmailMessageId: originalMessage.gmail_message_id,
        userId: 42,
        findMessage: async () => originalMessage,
        getGmailClient: async (options) => {
          requiredScopes = options.requiredScopes;
          return { gmail, gmailConnectionId: 9, gmailEmail: "owner@gmail.com" };
        },
        updateLabels: async (value) => { updated = value; },
      });

      assert.deepEqual(requiredScopes, [GMAIL_MODIFY_SCOPE]);
      assert.deepEqual(calls.modify, [{
        userId: "me",
        id: originalMessage.gmail_message_id,
        requestBody: { addLabelIds, removeLabelIds },
      }]);
      assert.deepEqual(updated.labelIds.sort(), expectedLabels.sort());
      assert.equal(updated.userId, 42);
    });
  }

  test("archives a spam message without moving it back to Inbox", async () => {
    const spamMessage = {
      ...originalMessage,
      label_ids: JSON.stringify(["SPAM", "UNREAD", "IMPORTANT"]),
    };
    const { gmail, calls } = createGmail();
    let updated;

    gmail.users.messages.modify = async (request) => {
      calls.modify.push(request);
      return { data: { id: request.id, labelIds: ["UNREAD", "IMPORTANT"] } };
    };

    await archiveGmailMessage({
      gmailMessageId: spamMessage.gmail_message_id,
      userId: 42,
      findMessage: async () => spamMessage,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      updateLabels: async (value) => { updated = value; },
    });

    assert.deepEqual(calls.modify[0].requestBody, {
      addLabelIds: [],
      removeLabelIds: ["INBOX", "SPAM"],
    });
    assert.deepEqual(updated.labelIds.sort(), ["IMPORTANT", "UNREAD"]);
  });

  test("moves an archived message to spam and persists the remote labels", async () => {
    const archivedMessage = {
      ...originalMessage,
      label_ids: JSON.stringify(["UNREAD", "IMPORTANT"]),
    };
    const { gmail, calls } = createGmail();
    let updated;

    gmail.users.messages.modify = async (request) => {
      calls.modify.push(request);
      return {
        data: {
          id: request.id,
          labelIds: ["SPAM", "UNREAD", "IMPORTANT"],
        },
      };
    };

    await markGmailMessageSpam({
      gmailMessageId: archivedMessage.gmail_message_id,
      userId: 42,
      findMessage: async () => archivedMessage,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      updateLabels: async (value) => { updated = value; },
    });

    assert.deepEqual(calls.modify[0].requestBody, {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
    assert.deepEqual(updated.labelIds.sort(), ["IMPORTANT", "SPAM", "UNREAD"]);
  });

  test("sends a threaded reply with RFC reply headers and the original subject", async () => {
    const { gmail, calls } = createGmail();
    let requiredScopes;
    let postSendDetails;

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: [
        "It's working!",
        "",
        "On Sat, 15 Aug 2026 at 09:59, <sender@example.com> wrote:",
        "> Original message body",
      ].join("\n"),
      findMessage: async () => originalMessage,
      getGmailClient: async (options) => {
        requiredScopes = options.requiredScopes;
        return { gmail, gmailConnectionId: 9, gmailEmail: "owner@gmail.com" };
      },
      onSent: async (details) => { postSendDetails = details; },
      persistReply: async () => {},
    });

    assert.deepEqual(requiredScopes, [GMAIL_SEND_SCOPE]);
    assert.equal(
      calls.send[0].requestBody.threadId,
      originalMessage.gmail_thread_id
    );
    const mime = decodeRaw(calls.send[0].requestBody.raw);
    assert.match(mime, /^To: sender@example\.com/m);
    assert.match(mime, /^Subject: Project update/m);
    assert.match(mime, /^In-Reply-To: <original@example\.com>/m);
    assert.match(mime, /^References: <original@example\.com>/m);
    assert.match(mime, /^Content-Type: multipart\/alternative;/m);
    assert.equal(
      decodeMimePart(mime, "text/plain"),
      [
        "It's working!",
        "",
        "On Thu, Aug 13, 2026 at 10:00 AM UTC, <sender@example.com> wrote:",
        "> Original message body",
      ].join("\r\n")
    );
    const htmlBody = decodeMimePart(mime, "text/html");
    assert.match(htmlBody, /<div dir="ltr">It&#39;s working!<\/div>/);
    assert.match(htmlBody, /class="gmail_attr">On Thu, Aug 13, 2026 at 10:00 AM UTC,/);
    assert.match(htmlBody, /<blockquote class="gmail_quote"/);
    assert.match(htmlBody, /Original message body<\/blockquote>/);
    assert.deepEqual(postSendDetails, {
      senderUserId: 42,
      recipientEmails: ["sender@example.com"],
    });
  });

  test("builds a valid multipart alternative with one HTML reply quote", async () => {
    const { gmail, calls } = createGmail();

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "Thank you.",
      findMessage: async () => originalMessage,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    const boundaryMatch = mime.match(
      /^Content-Type: multipart\/alternative; boundary="([^"\r\n]+)"$/m
    );
    assert.ok(boundaryMatch);

    const boundary = boundaryMatch[1];
    const delimiter = `--${boundary}`;
    assert.equal((mime.match(new RegExp(`^${delimiter}$`, "gm")) || []).length, 2);
    assert.equal((mime.match(new RegExp(`^${delimiter}--$`, "gm")) || []).length, 1);
    assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.match(mime, /Content-Type: text\/html; charset="UTF-8"/);

    const plainBody = decodeMimePart(mime, "text/plain");
    const htmlBody = decodeMimePart(mime, "text/html");
    assert.match(plainBody, /> Original message body$/);
    assert.equal((htmlBody.match(/<blockquote\b/g) || []).length, 1);
    assert.match(htmlBody, /<blockquote class="gmail_quote"[^>]*>Original message body<\/blockquote>/);
    assert.doesNotMatch(htmlBody, /&lt;\/?blockquote\b/);
    assert.doesNotMatch(htmlBody, /&gt;\s*Original message body/);
  });

  test("reply all excludes the connected account", async () => {
    const { gmail, calls } = createGmail();
    await replyAllToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "Thanks everyone.",
      findMessage: async () => originalMessage,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    assert.match(mime, /^To: sender@example\.com/m);
    assert.match(
      mime,
      /^Cc: teammate@example\.com, observer@example\.com/m
    );
    assert.doesNotMatch(mime, /owner@gmail\.com/);
    assert.match(mime, /^Content-Type: multipart\/alternative;/m);
    assert.match(decodeMimePart(mime, "text/plain"), /Thanks everyone\.\r\n\r\nOn Thu,/);
    assert.match(decodeMimePart(mime, "text/html"), /<blockquote class="gmail_quote"/);
  });

  test("does not nest an application-generated quote when replying again", async () => {
    const { gmail, calls } = createGmail();
    const previouslyGeneratedReply = {
      ...originalMessage,
      from_email: "sender@example.com",
      body_text: [
        "Success!",
        "",
        "On Wed, Aug 12, 2026 at 9:00 AM UTC, <older@example.com> wrote:",
        "> Original message",
      ].join("\r\n"),
    };

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "New reply text\nwith another line",
      findMessage: async () => previouslyGeneratedReply,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    const plainBody = decodeMimePart(mime, "text/plain");
    const htmlBody = decodeMimePart(mime, "text/html");
    assert.equal((plainBody.match(/ wrote:/g) || []).length, 1);
    assert.equal((htmlBody.match(/class="gmail_attr"/g) || []).length, 1);
    assert.equal((htmlBody.match(/<blockquote /g) || []).length, 1);
    assert.match(plainBody, /^New reply text\r\nwith another line\r\n\r\nOn Thu,/);
    assert.match(plainBody, /> Success!$/);
    assert.doesNotMatch(plainBody, /older@example\.com/);
    assert.match(htmlBody, /New reply text<br>with another line/);
    assert.doesNotMatch(htmlBody, /older@example\.com/);
  });

  test("recognizes a Gmail-folded backend attribution in the cached quote source", async () => {
    const { gmail, calls } = createGmail();
    const foldedGeneratedReply = {
      ...originalMessage,
      body_text: [
        "What is this?",
        "",
        "On Sun, Aug 16, 2026 at 12:10 PM UTC, Swati Sinha <sender@example.com>",
        "wrote:",
        "",
        "> anjdsi sd f0d",
        ">",
      ].join("\r\n"),
    };

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "Next reply",
      findMessage: async () => foldedGeneratedReply,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    const plainBody = decodeMimePart(mime, "text/plain");
    const htmlBody = decodeMimePart(mime, "text/html");
    assert.match(plainBody, /> What is this\?$/);
    assert.doesNotMatch(plainBody, /anjdsi sd f0d/);
    assert.doesNotMatch(htmlBody, /anjdsi sd f0d/);
  });

  test("recognizes the legacy frontend plain-text quote wrapper", async () => {
    const { gmail, calls } = createGmail();
    const legacyFrontendReply = {
      ...originalMessage,
      body_text: [
        "What is this?",
        "",
        "On Sun, 16 Aug 2026 at 17:40, <older@example.com> wrote:",
        "",
        "> anjdsi sd f0d",
        ">",
      ].join("\r\n"),
    };

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "Next reply",
      findMessage: async () => legacyFrontendReply,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const plainBody = decodeMimePart(
      decodeRaw(calls.send[0].requestBody.raw),
      "text/plain"
    );
    assert.match(plainBody, /> What is this\?$/);
    assert.doesNotMatch(plainBody, /older@example\.com|anjdsi sd f0d/);
  });

  test("recognizes nested legacy frontend HTML and folded backend wrappers", async () => {
    const { gmail, calls } = createGmail();
    const pollutedCachedReply = {
      ...originalMessage,
      body_text: [
        "nothing else<br><br>On Sun, 16 Aug 2026 at 17:40, sender@example.com",
        "wrote:<br><br><blockquote>What is this?<br><br>On Sun, 16 Aug 2026 at 17:40, wrote:<br><br>&gt; anjdsi sd f0d<br>&gt;</blockquote>",
        "",
        "On Sun, Aug 16, 2026 at 12:10 PM UTC, Swati Sinha <sender@example.com>",
        "wrote:",
        "",
        "> What is this?",
        ">",
        "> On Sun, 16 Aug 2026 at 17:40, <older@example.com> wrote:",
        ">",
        "> > anjdsi sd f0d",
      ].join("\r\n"),
    };

    await replyToGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      body: "Newest reply",
      findMessage: async () => pollutedCachedReply,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      persistReply: async () => {},
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    const plainBody = decodeMimePart(mime, "text/plain");
    const htmlBody = decodeMimePart(mime, "text/html");
    assert.match(plainBody, /> nothing else$/);
    assert.doesNotMatch(plainBody, /<br>|<blockquote>|What is this|anjdsi/);
    assert.match(htmlBody, /nothing else<\/blockquote>/);
    assert.doesNotMatch(htmlBody, /&lt;br&gt;|What is this|anjdsi/);
  });

  test("persists a confirmed Gmail reply once with verified Sent metadata", async () => {
    const persisted = [];
    const sentFixture = {
      id: "sent-message",
      threadId: originalMessage.gmail_thread_id,
      historyId: "456",
      internalDate: "1786615200000",
      labelIds: ["SENT"],
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Message-ID", value: "<sent@example.com>" },
          { name: "From", value: "owner@gmail.com" },
          { name: "To", value: "sender@example.com" },
          { name: "Subject", value: "Project update" },
        ],
        body: { data: Buffer.from("Reply body").toString("base64url") },
      },
    };

    const parsed = await persistSentGmailReply({
      gmail: {
        users: {
          messages: {
            get: async (request) => {
              assert.deepEqual(request, {
                userId: "me",
                id: "sent-message",
                format: "FULL",
              });
              return { data: sentFixture };
            },
          },
        },
      },
      gmailConnectionId: 9,
      gmailEmail: "owner@gmail.com",
      gmailMessageId: "sent-message",
      gmailThreadId: originalMessage.gmail_thread_id,
      recipientEmails: ["sender@example.com"],
      persistMessages: async (value) => { persisted.push(value); },
    });

    assert.equal(parsed.gmailMessageId, "sent-message");
    assert.equal(parsed.gmailThreadId, originalMessage.gmail_thread_id);
    assert.equal(parsed.fromEmail, "owner@gmail.com");
    assert.deepEqual(parsed.labelIds, ["SENT"]);
    assert.equal(parsed.recipients[0].email, "sender@example.com");
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0], {
      gmailConnectionId: 9,
      messages: [parsed],
    });
  });

  for (const [status, expectedCode, expectedStatus] of [
    [401, "gmail_auth_failed", 401],
    [403, "gmail_action_forbidden", 403],
    [404, "gmail_thread_not_found", 404],
    [500, "gmail_api_failed", 502],
  ]) {
    test(`does not report reply success when Gmail send returns ${status}`, async () => {
      const { gmail, calls } = createGmail();
      let postSendCalled = false;
      let persistReplyCalled = false;
      gmail.users.messages.send = async (request) => {
        calls.send.push(request);
        const error = new Error("Google API failure");
        error.response = { status };
        throw error;
      };

      await assert.rejects(
        replyToGmailMessage({
          gmailMessageId: originalMessage.gmail_message_id,
          userId: 42,
          body: "This must not be saved as delivered.",
          findMessage: async (messageId) => {
            assert.equal(messageId, originalMessage.gmail_message_id);
            assert.notEqual(messageId, originalMessage.id);
            return originalMessage;
          },
          getGmailClient: async () => ({
            gmail,
            gmailConnectionId: 9,
            gmailEmail: "owner@gmail.com",
          }),
          persistReply: async () => { persistReplyCalled = true; },
          onSent: async () => { postSendCalled = true; },
        }),
        (error) =>
          error instanceof GmailMessageActionError &&
          error.code === expectedCode &&
          error.statusCode === expectedStatus
      );
      assert.equal(calls.send.length, 1);
      assert.equal(persistReplyCalled, false);
      assert.equal(postSendCalled, false);
    });
  }

  test("does not report reply success without confirmed Gmail IDs", async () => {
    const { gmail } = createGmail();
    gmail.users.messages.send = async () => ({ data: {} });

    await assert.rejects(
      replyToGmailMessage({
        gmailMessageId: originalMessage.gmail_message_id,
        userId: 42,
        body: "Confirmation is required.",
        findMessage: async () => originalMessage,
        getGmailClient: async () => ({
          gmail,
          gmailConnectionId: 9,
          gmailEmail: "owner@gmail.com",
        }),
      }),
      (error) =>
        error instanceof GmailMessageActionError &&
        error.code === "gmail_delivery_unconfirmed" &&
        error.statusCode === 502
    );
  });

  test("does not report Reply All success when Gmail rejects delivery", async () => {
    const { gmail, calls } = createGmail();
    gmail.users.messages.send = async (request) => {
      calls.send.push(request);
      const error = new Error("Forbidden");
      error.response = { status: 403 };
      throw error;
    };

    await assert.rejects(
      replyAllToGmailMessage({
        gmailMessageId: originalMessage.gmail_message_id,
        userId: 42,
        body: "Reply All must be externally delivered.",
        findMessage: async () => originalMessage,
        getGmailClient: async () => ({
          gmail,
          gmailConnectionId: 9,
          gmailEmail: "owner@gmail.com",
        }),
      }),
      (error) =>
        error instanceof GmailMessageActionError &&
        error.code === "gmail_action_forbidden" &&
        error.statusCode === 403
    );
    assert.equal(calls.send.length, 1);
  });

  test("forwards the original content to a validated destination", async () => {
    const { gmail, calls } = createGmail();
    let postSendDetails;
    await forwardGmailMessage({
      gmailMessageId: originalMessage.gmail_message_id,
      userId: 42,
      to: "destination@example.com",
      body: "For your review.",
      findMessage: async () => originalMessage,
      getGmailClient: async () => ({
        gmail,
        gmailConnectionId: 9,
        gmailEmail: "owner@gmail.com",
      }),
      onSent: async (details) => { postSendDetails = details; },
    });

    const request = calls.send[0].requestBody;
    assert.equal(request.threadId, undefined);
    const mime = decodeRaw(request.raw);
    assert.match(mime, /^To: destination@example\.com/m);
    assert.match(mime, /^Subject: Fwd: Project update/m);
    const encodedBody = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    const body = Buffer.from(encodedBody, "base64").toString("utf8");
    assert.match(body, /For your review\./);
    assert.match(body, /Original message body/);
    assert.deepEqual(postSendDetails, {
      senderUserId: 42,
      recipientEmails: ["destination@example.com"],
    });
  });
});
