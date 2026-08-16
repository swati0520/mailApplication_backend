import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isGmailBackedSentMail } from "../controllers/mailController.js";

describe("mail reply source detection", () => {
  test("routes a Gmail-delivered sender copy through Gmail", () => {
    assert.equal(isGmailBackedSentMail({
      mailbox_role: "sender",
      gmail_delivery_status: "sent",
      gmail_message_id: "18f_gmail-message",
    }), true);
  });

  test("keeps an internal project reply on the internal path", () => {
    assert.equal(isGmailBackedSentMail({
      mailbox_role: "sender",
      gmail_delivery_status: "internal_only",
      gmail_message_id: null,
    }), false);
  });

  test("does not use another account's sender-side Gmail ID for a receiver copy", () => {
    assert.equal(isGmailBackedSentMail({
      mailbox_role: "receiver",
      gmail_delivery_status: "sent",
      gmail_message_id: "sender-account-message-id",
    }), false);
  });
});
