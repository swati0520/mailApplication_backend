import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createDraft,
  deleteDraft,
  DraftServiceError,
  getDraftById,
  getDrafts,
  sendDraft,
  updateDraft,
} from "../services/draftService.js";
import { GmailComposeDeliveryError } from "../services/gmailComposeDeliveryService.js";

const user = { id: 7, email: "owner@gmail.com" };

const createDraftStore = () => {
  const drafts = new Map();
  let createCount = 0;
  const findDraft = async (draftId, userId) => {
    const draft = drafts.get(Number(draftId));
    return draft && draft.sender_user_id === userId && draft.status === "draft"
      ? { ...draft }
      : undefined;
  };
  const createRecord = async (
    senderId,
    receiverId,
    fromEmail,
    toEmail,
    cc,
    bcc,
    subject,
    body
  ) => {
    createCount += 1;
    const id = 15;
    drafts.set(id, {
      id,
      sender_user_id: senderId,
      receiver_user_id: receiverId,
      from_email: fromEmail,
      to_email: toEmail,
      cc,
      bcc,
      subject,
      body,
      status: "draft",
      gmail_delivery_status: "internal_only",
    });
    return { insertId: id };
  };
  const updateRecord = async (
    draftId,
    userId,
    receiverId,
    toEmail,
    cc,
    bcc,
    subject,
    body
  ) => {
    const draft = await findDraft(draftId, userId);
    if (!draft || draft.gmail_delivery_status === "pending") {
      return { affectedRows: 0 };
    }
    drafts.set(Number(draftId), {
      ...draft,
      receiver_user_id: receiverId,
      to_email: toEmail,
      cc,
      bcc,
      subject,
      body,
    });
    return { affectedRows: 1 };
  };
  return { drafts, findDraft, createRecord, updateRecord, getCreateCount: () => createCount };
};

describe("Draft service", () => {
  test("creates once and updates the same draft ID across repeated autosaves", async () => {
    const store = createDraftStore();
    const created = await createDraft({
      userId: user.id,
      data: { subject: "First characters", body: "Hel" },
      findUser: async () => user,
      createRecord: store.createRecord,
      findDraft: store.findDraft,
      getDraftAttachments: async () => [],
    });

    const firstUpdate = await updateDraft({
      draftId: created.id,
      userId: user.id,
      data: { body: "Hello", cc: "copy@example.com" },
      findDraft: store.findDraft,
      updateRecord: store.updateRecord,
      getDraftAttachments: async () => [],
    });
    const secondUpdate = await updateDraft({
      draftId: created.id,
      userId: user.id,
      data: { body: "Hello world" },
      findDraft: store.findDraft,
      updateRecord: store.updateRecord,
      getDraftAttachments: async () => [],
    });

    assert.equal(created.id, 15);
    assert.equal(firstUpdate.id, 15);
    assert.equal(secondUpdate.id, 15);
    assert.equal(secondUpdate.body, "Hello world");
    assert.equal(secondUpdate.cc, "copy@example.com");
    assert.equal(store.getCreateCount(), 1);
    assert.equal(store.drafts.size, 1);
  });

  test("returns attachment information only with an owned draft", async () => {
    const ownedDraft = {
      id: 15,
      sender_user_id: user.id,
      status: "draft",
      to_email: "recipient@example.com",
      cc: null,
      bcc: null,
    };
    const draft = await getDraftById({
      draftId: 15,
      userId: user.id,
      findDraft: async (draftId, userId) =>
        draftId === 15 && userId === user.id ? ownedDraft : undefined,
      getDraftAttachments: async () => [{ id: 3, file_name: "report.pdf" }],
    });
    assert.deepEqual(draft.attachments, [{ id: 3, file_name: "report.pdf" }]);

    await assert.rejects(
      getDraftById({
        draftId: 15,
        userId: 999,
        findDraft: async () => undefined,
      }),
      (error) => error instanceof DraftServiceError && error.statusCode === 404
    );
  });

  test("lists and deletes only through owner-scoped model calls", async () => {
    const listCalls = [];
    const listed = await getDrafts({
      userId: user.id,
      limit: 10,
      offset: 0,
      listDrafts: async (...args) => {
        listCalls.push(args);
        return {
          mails: [{ id: 15, sender_user_id: user.id, to_email: "", cc: null, bcc: null }],
          totalMails: 1,
        };
      },
      getDraftAttachments: async () => [],
    });
    assert.deepEqual(listCalls, [[user.id, 10, 0]]);
    assert.equal(listed.drafts[0].id, 15);

    const deleteCalls = [];
    await deleteDraft({
      draftId: 15,
      userId: user.id,
      findDraft: async (draftId, userId) =>
        draftId === 15 && userId === user.id ? { id: 15 } : undefined,
      deleteRecord: async (...args) => {
        deleteCalls.push(args);
        return { affectedRows: 1, attachmentPaths: ["uploads/draft.txt"] };
      },
      removeStoredFile: async () => {},
    });
    assert.deepEqual(deleteCalls, [[15, user.id]]);

    let foreignDeleteCalled = false;
    await assert.rejects(
      deleteDraft({
        draftId: 15,
        userId: 999,
        findDraft: async () => undefined,
        deleteRecord: async () => {
          foreignDeleteCalled = true;
          return { affectedRows: 1 };
        },
      }),
      (error) => error instanceof DraftServiceError && error.statusCode === 404
    );
    assert.equal(foreignDeleteCalled, false);
  });

  test("sends through the existing Gmail Compose sender and finalizes the same row", async () => {
    const draft = {
      id: 15,
      sender_user_id: user.id,
      from_email: user.email,
      to_email: "recipient@example.com",
      cc: '["copy@example.com"]',
      bcc: null,
      subject: "Draft subject",
      body: "Draft body",
      status: "draft",
      gmail_delivery_status: "internal_only",
    };
    const gmailCalls = [];
    let finalized;
    const result = await sendDraft({
      draftId: draft.id,
      userId: user.id,
      findUser: async () => user,
      findDraft: async () => draft,
      findRecipient: async (email) => ({
        id: email === "recipient@example.com" ? 8 : 9,
        email,
      }),
      claimDraft: async () => ({ affectedRows: 1 }),
      sendGmail: async (options) => {
        gmailCalls.push(options);
        return {
          deliveryStatus: "sent",
          gmailMessageId: "gmail-message",
          gmailThreadId: "gmail-thread",
        };
      },
      getAttachmentFiles: async () => [],
      finalizeSend: async (options) => {
        finalized = options;
        return { status: "sent", mailId: draft.id };
      },
      triggerSync: async () => {},
    });

    assert.equal(gmailCalls.length, 1);
    assert.deepEqual(gmailCalls[0].to, ["recipient@example.com"]);
    assert.deepEqual(gmailCalls[0].cc, ["copy@example.com"]);
    assert.equal(finalized.mailId, 15);
    assert.equal(finalized.gmailDeliveryStatus, "sent");
    assert.equal(result.mailId, 15);
    assert.equal(result.draftId, 15);
  });

  test("keeps the row as a draft when Gmail definitively rejects delivery", async () => {
    const draft = {
      id: 15,
      sender_user_id: user.id,
      to_email: "recipient@example.com",
      cc: null,
      bcc: null,
      subject: "Draft subject",
      body: "Draft body",
      status: "draft",
    };
    let markedDelivery;
    let finalizeCalled = false;
    await assert.rejects(
      sendDraft({
        draftId: draft.id,
        userId: user.id,
        findUser: async () => user,
        findDraft: async () => draft,
        findRecipient: async (email) => ({ id: 8, email }),
        claimDraft: async () => ({ affectedRows: 1 }),
        markDelivery: async (value) => { markedDelivery = value; },
        sendGmail: async () => {
          throw new GmailComposeDeliveryError(
            "gmail_delivery_rejected",
            "Gmail rejected the composed message",
            502,
            "failed"
          );
        },
        getAttachmentFiles: async () => [],
        finalizeSend: async () => { finalizeCalled = true; },
      }),
      (error) => error.code === "gmail_delivery_rejected"
    );
    assert.equal(markedDelivery.deliveryStatus, "failed");
    assert.equal(finalizeCalled, false);
    assert.equal(draft.status, "draft");
  });

  test("prevents a second send while the same draft is already claimed", async () => {
    const draft = {
      id: 15,
      sender_user_id: user.id,
      status: "draft",
      gmail_delivery_status: "pending",
    };
    let gmailCalled = false;
    await assert.rejects(
      sendDraft({
        draftId: draft.id,
        userId: user.id,
        findUser: async () => user,
        findDraft: async () => draft,
        claimDraft: async () => ({ affectedRows: 0 }),
        sendGmail: async () => { gmailCalled = true; },
      }),
      (error) =>
        error instanceof DraftServiceError &&
        error.code === "draft_send_in_progress" &&
        error.statusCode === 409
    );
    assert.equal(gmailCalled, false);
  });
});
