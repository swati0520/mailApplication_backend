import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createGmailIncomingNotifications,
  createInternalIncomingNotifications,
  emitNewNotifications,
} from "../services/incomingMailNotificationService.js";

const gmailMessage = (overrides = {}) => ({
  gmailMessageId: "gmail-1",
  fromEmail: "sender@example.com",
  fromName: "Sender",
  subject: "Hello",
  labelIds: ["INBOX", "UNREAD"],
  ...overrides,
});

const createIdempotentStore = () => {
  const records = new Map();
  let nextId = 1;
  return {
    records,
    create: async (notification) => {
      const key = `${notification.userId}:${notification.sourceKey}`;
      if (records.has(key)) return null;
      const value = {
        id: nextId++,
        userId: notification.userId,
        mailId: notification.mailId,
        title: notification.title,
        message: notification.message,
        isRead: false,
      };
      records.set(key, value);
      return value;
    },
  };
};

describe("incoming mail notification producer", () => {
  test("creates a notification for a new incoming Gmail message", async () => {
    const store = createIdempotentStore();
    const notifications = await createGmailIncomingNotifications({
      gmailConnectionId: 9,
      userId: 42,
      gmailEmail: "owner@gmail.com",
      insertedMessages: [{ messageRecordId: 100, message: gmailMessage() }],
      createNotification: store.create,
    });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].userId, 42);
    assert.equal(notifications[0].mailId, null);
    assert.equal(notifications[0].message, "Hello");
  });

  test("does not duplicate the same Gmail notification", async () => {
    const store = createIdempotentStore();
    const options = {
      gmailConnectionId: 9,
      userId: 42,
      gmailEmail: "owner@gmail.com",
      insertedMessages: [{ messageRecordId: 100, message: gmailMessage() }],
      createNotification: store.create,
    };

    assert.equal((await createGmailIncomingNotifications(options)).length, 1);
    assert.equal((await createGmailIncomingNotifications(options)).length, 0);
    assert.equal(store.records.size, 1);
  });

  test("emits newNotification only to the receiving user's room", () => {
    const calls = [];
    const io = {
      to(room) {
        return { emit: (event, payload) => calls.push({ room, event, payload }) };
      },
    };
    const notification = { id: 1, userId: 42, message: "Hello" };

    assert.equal(emitNewNotifications([notification], io), 1);
    assert.deepEqual(calls, [{
      room: "user_42",
      event: "newNotification",
      payload: notification,
    }]);
  });

  test("uses the Gmail connection owner as the receiving user", async () => {
    const calls = [];
    await createGmailIncomingNotifications({
      gmailConnectionId: 9,
      userId: 77,
      gmailEmail: "recipient@gmail.com",
      insertedMessages: [{ messageRecordId: 101, message: gmailMessage() }],
      createNotification: async (value) => {
        calls.push(value);
        return { id: 1, userId: value.userId };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].userId, 77);
  });

  test("does not notify the Gmail owner for their own outgoing message", async () => {
    let created = false;
    const notifications = await createGmailIncomingNotifications({
      gmailConnectionId: 9,
      userId: 42,
      gmailEmail: "OWNER@gmail.com",
      insertedMessages: [{
        messageRecordId: 102,
        message: gmailMessage({ fromEmail: "owner@gmail.com", labelIds: ["SENT"] }),
      }],
      createNotification: async () => {
        created = true;
      },
    });

    assert.equal(created, false);
    assert.deepEqual(notifications, []);
  });

  test("creates internal notifications for receivers but never the sender", async () => {
    const store = createIdempotentStore();
    const notifications = await createInternalIncomingNotifications({
      mailId: 55,
      senderUserId: 1,
      senderEmail: "sender@example.com",
      subject: "Internal hello",
      recipients: [
        { userId: 1, recipientType: "to" },
        { userId: 2, recipientType: "to" },
        { userId: 3, recipientType: "cc" },
      ],
      createNotification: store.create,
    });

    assert.deepEqual(notifications.map(({ userId }) => userId), [2, 3]);
    assert.equal(store.records.size, 2);
  });
});
