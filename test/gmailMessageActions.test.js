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
    ["archive", archiveGmailMessage, [], ["INBOX"], ["UNREAD"]],
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
    const encodedBody = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    assert.equal(Buffer.from(encodedBody, "base64").toString("utf8"), "It's working!");
    assert.deepEqual(postSendDetails, {
      senderUserId: 42,
      recipientEmails: ["sender@example.com"],
    });
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
    });

    const mime = decodeRaw(calls.send[0].requestBody.raw);
    assert.match(mime, /^To: sender@example\.com/m);
    assert.match(
      mime,
      /^Cc: teammate@example\.com, observer@example\.com/m
    );
    assert.doesNotMatch(mime, /owner@gmail\.com/);
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
