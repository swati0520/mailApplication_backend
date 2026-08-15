import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GMAIL_SEND_SCOPE } from "../config/gmailOAuth.js";
import {
  GmailComposeDeliveryError,
  sendNewGmailMessage,
} from "../services/gmailComposeDeliveryService.js";
import { buildGmailRawMessage } from "../utils/gmailMimeBuilder.js";

const decodeRaw = (raw) => Buffer.from(raw, "base64url").toString("utf8");

describe("Gmail Compose delivery", () => {
  test("sends a new message with the Gmail send scope and no thread ID", async () => {
    const calls = [];
    let clientOptions;
    const result = await sendNewGmailMessage({
      userId: 42,
      to: ["recipient@example.com"],
      cc: ["copy@example.com"],
      subject: "Sick leave",
      body: "testing mail",
      getGmailClient: async (options) => {
        clientOptions = options;
        return {
          gmailEmail: "owner@gmail.com",
          gmail: {
            users: {
              messages: {
                send: async (request) => {
                  calls.push(request);
                  return { data: { id: "gmail-message", threadId: "gmail-thread" } };
                },
              },
            },
          },
        };
      },
    });

    assert.deepEqual(clientOptions.requiredScopes, [GMAIL_SEND_SCOPE]);
    assert.equal(clientOptions.userId, 42);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].userId, "me");
    assert.equal(Object.hasOwn(calls[0].requestBody, "threadId"), false);
    const mime = decodeRaw(calls[0].requestBody.raw);
    assert.match(mime, /^From: owner@gmail\.com/m);
    assert.match(mime, /^To: recipient@example\.com/m);
    assert.match(mime, /^Cc: copy@example\.com/m);
    assert.match(mime, /^Subject: Sick leave/m);
    assert.deepEqual(result, {
      deliveryStatus: "sent",
      gmailMessageId: "gmail-message",
      gmailThreadId: "gmail-thread",
    });
  });

  test("keeps delivery internal when Gmail is not connected", async () => {
    const result = await sendNewGmailMessage({
      userId: 42,
      to: ["recipient@example.com"],
      subject: "Internal message",
      body: "Body",
      getGmailClient: async () => {
        const error = new Error("not connected");
        error.code = "gmail_not_connected";
        throw error;
      },
    });

    assert.deepEqual(result, { deliveryStatus: "internal_only" });
  });

  test("builds multipart MIME with BCC and binary attachments", () => {
    const raw = buildGmailRawMessage({
      from: "owner@gmail.com",
      to: ["recipient@example.com"],
      bcc: ["hidden@example.com"],
      subject: "Attached report",
      body: "Please see the report.",
      attachments: [{
        originalname: "report.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from([0, 1, 2, 3, 254, 255]),
      }],
    });
    const mime = decodeRaw(raw);

    assert.match(mime, /^Bcc: hidden@example\.com/m);
    assert.match(mime, /Content-Type: multipart\/mixed; boundary="([^"]+)"/);
    assert.match(mime, /Content-Type: application\/pdf; name="report\.pdf"/);
    assert.match(
      mime,
      /Content-Disposition: attachment; filename="report\.pdf"; filename\*=UTF-8''report\.pdf/
    );
    assert.match(mime, /AAECA\/7\//);
  });

  test("marks definitive Gmail rejection as failed", async () => {
    await assert.rejects(
      sendNewGmailMessage({
        userId: 42,
        to: ["recipient@example.com"],
        subject: "Rejected",
        body: "Body",
        getGmailClient: async () => ({
          gmailEmail: "owner@gmail.com",
          gmail: {
            users: {
              messages: {
                send: async () => {
                  const error = new Error("bad request");
                  error.response = { status: 400 };
                  throw error;
                },
              },
            },
          },
        }),
      }),
      (error) => {
        assert.ok(error instanceof GmailComposeDeliveryError);
        assert.equal(error.code, "gmail_delivery_rejected");
        assert.equal(error.deliveryStatus, "failed");
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
  });

  test("marks an attachment without uploaded content as failed before sending", async () => {
    let sendCalled = false;
    await assert.rejects(
      sendNewGmailMessage({
        userId: 42,
        to: ["recipient@example.com"],
        subject: "Broken attachment",
        body: "Body",
        attachments: [{
          originalname: "missing.pdf",
          mimetype: "application/pdf",
        }],
        getGmailClient: async () => ({
          gmailEmail: "owner@gmail.com",
          gmail: {
            users: {
              messages: {
                send: async () => {
                  sendCalled = true;
                },
              },
            },
          },
        }),
      }),
      (error) => {
        assert.equal(error.code, "gmail_attachment_invalid");
        assert.equal(error.deliveryStatus, "failed");
        assert.equal(error.statusCode, 400);
        return true;
      }
    );
    assert.equal(sendCalled, false);
  });

  test("leaves ambiguous Gmail failures pending", async () => {
    await assert.rejects(
      sendNewGmailMessage({
        userId: 42,
        to: ["recipient@example.com"],
        subject: "Unconfirmed",
        body: "Body",
        getGmailClient: async () => ({
          gmailEmail: "owner@gmail.com",
          gmail: {
            users: {
              messages: {
                send: async () => {
                  const error = new Error("connection reset");
                  error.code = "ECONNRESET";
                  throw error;
                },
              },
            },
          },
        }),
      }),
      (error) => {
        assert.ok(error instanceof GmailComposeDeliveryError);
        assert.equal(error.code, "gmail_delivery_unconfirmed");
        assert.equal(error.deliveryStatus, "pending");
        assert.equal(error.statusCode, 503);
        return true;
      }
    );
  });
});
