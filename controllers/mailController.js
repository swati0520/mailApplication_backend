import expressAsyncHandler from "express-async-handler";
import {
  cancelScheduledMail,
  createDraft,
  createMail,
  createReplyAllMail,
  createScheduledMail,
  deleteDraft,
  deleteReceivedMailQuery,
  deleteSentMailQuery,
  emptyTrashForUser,
  findMailById,
  findMailForUser,
  findOwnedDraft,
  findOwnedScheduledMail,
  getAllMails,
  getDraftMails,
  getInboxMails,
  getMailRecipients,
  getScheduledMails,
  getSentMails,
  getSnoozedMails,
  getStateFolderMails,
  getTrashMails,
  isUserMailRecipient,
  markMailAsArchived,
  markMailAsImportant,
  markMailAsRead,
  markMailAsSpam,
  markMailAsStarred,
  markMailAsUnarchived,
  markMailAsUnimportant,
  markMailAsUnread,
  markMailAsUnspam,
  markMailAsUnstarred,
  permanentlyDeleteMailCopy,
  restoreMailCopy,
  searchMails,
  sendDraft,
  setMailThreadId,
  snoozeMailState,
  unsnoozeMailState,
  updateDraft,
  updateScheduledMail,
} from "../models/Mail.js";
import { findUserByEmail, findUserById } from "../models/User.js";
import {
  cleanupAttachmentFiles,
  persistAttachmentFile,
} from "../utils/attachmentStorage.js";

const getPagination = (req) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  return { page, limit, offset: (page - 1) * limit };
};

const paginationResponse = (page, limit, totalMails) => ({
  page,
  limit,
  totalMails,
  totalPages: Math.ceil(totalMails / limit),
});

const getAuthorizedMail = async (
  req,
  res,
  { ownerField, notFoundMessage = "Mail not found" } = {}
) => {
  const mailId = req.params.mailId ?? req.params._id;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ message: "Unauthorized user" });
    return null;
  }

  const mail = await findMailById(mailId);
  if (!mail) {
    res.status(404).json({ message: notFoundMessage });
    return null;
  }

  const isSender = String(mail.sender_user_id) === String(userId);
  const isRecipient = isSender
    ? false
    : await isUserMailRecipient(mailId, userId);

  if (
    (ownerField === "sender_user_id" && !isSender) ||
    (ownerField === "receiver_user_id" && !isRecipient) ||
    (!ownerField && !isSender && !isRecipient)
  ) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }

  const userScopedMail = await findMailForUser(mailId, userId);
  if (
    !userScopedMail ||
    userScopedMail.is_deleted ||
    userScopedMail.is_permanently_deleted
  ) {
    res.status(404).json({ message: notFoundMessage });
    return null;
  }
  return userScopedMail;
};

const updateAuthorizedMailState = async (
  req,
  res,
  { update, allowedRoles, successMessage }
) => {
  const mail = await getAuthorizedMail(req, res);
  if (!mail) return;

  if (!allowedRoles.includes(mail.mailbox_role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const result = await update(req.params.mailId, req.user.id);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Mail not found" });
  }
  return res.status(200).json({ message: successMessage });
};

const getRecipient = async (email) => {
  if (typeof email !== "string" || !email.trim()) return null;
  return findUserByEmail(email.trim().toLowerCase());
};

const normalizeRecipientInput = (value, fieldName) => {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];

  return values.map((email) => {
    if (typeof email !== "string" || !email.trim()) {
      throw new TypeError(`${fieldName} must contain valid email addresses`);
    }
    return email.trim().toLowerCase();
  });
};

const deduplicateRecipients = (recipientGroups) => {
  const seenEmails = new Set();
  const recipients = [];

  for (const [recipientType, emails] of recipientGroups) {
    for (const email of emails) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      recipients.push({ email, recipientType });
    }
  }

  return recipients;
};

const getCurrentUser = async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  return user;
};

const listStateFolder = (stateField, responseField) =>
  expressAsyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req);
    const { mails, totalMails } = await getStateFolderMails(
      req.user.id,
      stateField,
      limit,
      offset
    );
    return res.status(200).json({
      [responseField]: mails,
      pagination: paginationResponse(page, limit, totalMails),
    });
  });

export const sendMail = expressAsyncHandler(async (req, res) => {
  const { to, cc, bcc, body, subject } = req.body;
  let toEmails;
  let ccEmails;
  let bccEmails;

  try {
    toEmails = normalizeRecipientInput(to, "To");
    ccEmails = normalizeRecipientInput(cc, "CC");
    bccEmails = normalizeRecipientInput(bcc, "BCC");
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  if (toEmails.length === 0) {
    return res.status(400).json({ message: "At least one To recipient is required" });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return res.status(400).json({ message: "Subject is required" });
  }
  if (typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ message: "Mail body is required" });
  }

  const user = await getCurrentUser(req, res);
  if (!user) return;
  const senderEmail = user.email.trim().toLowerCase();
  const normalizedRecipients = deduplicateRecipients([
    ["to", toEmails],
    ["cc", ccEmails],
    ["bcc", bccEmails],
  ]);

  if (normalizedRecipients.some((recipient) => recipient.email === senderEmail)) {
    return res.status(400).json({ message: "Sending mail to yourself is not supported" });
  }

  const resolvedUsers = await Promise.all(
    normalizedRecipients.map((recipient) => findUserByEmail(recipient.email))
  );
  const missingRecipientIndex = resolvedUsers.findIndex((recipient) => !recipient);
  if (missingRecipientIndex !== -1) {
    return res.status(404).json({
      message: `Recipient user not found: ${normalizedRecipients[missingRecipientIndex].email}`,
    });
  }

  const seenUserIds = new Set();
  const recipients = [];
  normalizedRecipients.forEach((recipient, index) => {
    const resolvedUser = resolvedUsers[index];
    if (String(resolvedUser.id) === String(user.id)) return;
    if (seenUserIds.has(String(resolvedUser.id))) return;
    seenUserIds.add(String(resolvedUser.id));
    recipients.push({
      userId: resolvedUser.id,
      email: recipient.email,
      recipientType: recipient.recipientType,
    });
  });

  if (recipients.length !== normalizedRecipients.length) {
    return res.status(400).json({ message: "Sending mail to yourself is not supported" });
  }

  const primaryTo = recipients.find(
    (recipient) => recipient.recipientType === "to"
  );
  if (!primaryTo) {
    return res.status(400).json({ message: "At least one To recipient is required" });
  }

  const legacyCc = recipients
    .filter((recipient) => recipient.recipientType === "cc")
    .map((recipient) => recipient.email);
  const legacyBcc = recipients
    .filter((recipient) => recipient.recipientType === "bcc")
    .map((recipient) => recipient.email);

  const storedAttachments = [];
  try {
    for (const file of req.files ?? []) {
      storedAttachments.push(await persistAttachmentFile(file));
    }

    const data = await createMail(
      user.id,
      primaryTo.userId,
      senderEmail,
      primaryTo.email,
      legacyCc.length ? JSON.stringify(legacyCc) : null,
      legacyBcc.length ? JSON.stringify(legacyBcc) : null,
      subject.trim(),
      body.trim(),
      "sent",
      null,
      recipients,
      storedAttachments
    );
    return res.status(201).json({
      message: "Email sent successfully",
      mail: data,
      attachmentCount: storedAttachments.length,
    });
  } catch (error) {
    await cleanupAttachmentFiles(storedAttachments);
    throw error;
  }
});

export const getSentMail = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getSentMails(
    req.user.id,
    limit,
    offset
  );
  return res.status(200).json({
    sentMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const getReceivedMail = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getInboxMails(
    req.user.id,
    limit,
    offset
  );
  return res.status(200).json({
    receivedMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const getAllMail = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getAllMails(
    req.user.id,
    limit,
    offset
  );
  return res.status(200).json({
    allMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const getStarredMail = listStateFolder("is_starred", "starredMails");
export const getImportantMail = listStateFolder("is_important", "importantMails");
export const getArchivedMail = listStateFolder("is_archived", "archivedMails");
export const getSpamMail = listStateFolder("is_spam", "spamMails");

export const getSnoozedMail = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getSnoozedMails(
    req.user.id,
    limit,
    offset
  );
  return res.status(200).json({
    snoozedMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const searchMail = expressAsyncHandler(async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.status(400).json({ message: "Search query is required" });
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await searchMails(
    req.user.id,
    query,
    limit,
    offset
  );
  return res.status(200).json({
    mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const deleteSentMail = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res, { ownerField: "sender_user_id" });
  if (!mail) return;
  await deleteSentMailQuery(req.params._id, req.user.id);
  return res.status(200).json({ message: "Mail deleted successfully" });
});

export const deleteReceivedMail = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res, {
    ownerField: "receiver_user_id",
  });
  if (!mail) return;
  await deleteReceivedMailQuery(req.params._id, req.user.id);
  return res.status(200).json({ message: "Mail deleted successfully" });
});

export const getTrashMail = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getTrashMails(
    req.user.id,
    limit,
    offset
  );
  return res.status(200).json({
    trashMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const restoreMail = expressAsyncHandler(async (req, res) => {
  const result = await restoreMailCopy(req.params.mailId, req.user.id);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Mail not found in trash" });
  }
  return res.status(200).json({ message: "Mail restored successfully" });
});

export const permanentlyDeleteMail = expressAsyncHandler(async (req, res) => {
  const status = await permanentlyDeleteMailCopy(req.params.mailId, req.user.id);
  if (status === "forbidden") return res.status(403).json({ message: "Forbidden" });
  if (status !== "deleted") {
    return res.status(404).json({ message: "Mail not found in trash" });
  }
  return res.status(200).json({ message: "Mail permanently deleted" });
});

export const emptyTrash = expressAsyncHandler(async (req, res) => {
  const deletedMails = await emptyTrashForUser(req.user.id);
  return res.status(200).json({
    message: "Trash emptied successfully",
    deletedMails,
  });
});

export const getMailDetails = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res);
  if (!mail) return;
  const recipients = await getMailRecipients(req.params.mailId, req.user.id);
  return res.status(200).json({
    message: "Mail fetched successfully",
    mail: { ...mail, recipients },
  });
});

export const readMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsRead,
    allowedRoles: ["receiver"],
    successMessage: "Mail marked as read successfully",
  })
);
export const unreadMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsUnread,
    allowedRoles: ["receiver"],
    successMessage: "Mail marked as unread successfully",
  })
);
export const starMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsStarred,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail starred successfully",
  })
);
export const unstarMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsUnstarred,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail unstarred successfully",
  })
);
export const importantMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsImportant,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail marked as important successfully",
  })
);
export const unimportantMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsUnimportant,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail marked as unimportant successfully",
  })
);
export const archiveMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsArchived,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail archived successfully",
  })
);
export const unarchiveMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsUnarchived,
    allowedRoles: ["sender", "receiver"],
    successMessage: "Mail unarchived successfully",
  })
);
export const spamMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsSpam,
    allowedRoles: ["receiver"],
    successMessage: "Mail marked as spam successfully",
  })
);
export const unspamMail = expressAsyncHandler((req, res) =>
  updateAuthorizedMailState(req, res, {
    update: markMailAsUnspam,
    allowedRoles: ["receiver"],
    successMessage: "Mail unmarked as spam successfully",
  })
);

export const snoozeMail = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res);
  if (!mail) return;

  const snoozedUntil = new Date(req.body.snoozedUntil);
  if (
    !req.body.snoozedUntil ||
    Number.isNaN(snoozedUntil.getTime()) ||
    snoozedUntil <= new Date()
  ) {
    return res.status(400).json({
      message: "A valid future snoozedUntil value is required",
    });
  }

  const result = await snoozeMailState(
    req.params.mailId,
    req.user.id,
    snoozedUntil
  );
  if (result.affectedRows === 0) {
    return res.status(400).json({
      message: "Snooze time must be in the future",
    });
  }
  return res.status(200).json({ message: "Mail snoozed successfully" });
});

export const unsnoozeMail = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res);
  if (!mail) return;

  const result = await unsnoozeMailState(req.params.mailId, req.user.id);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Mail not found" });
  }
  return res.status(200).json({ message: "Mail unsnoozed successfully" });
});

export const createDraftMail = expressAsyncHandler(async (req, res) => {
  const user = await getCurrentUser(req, res);
  if (!user) return;
  const to = typeof req.body.to === "string" ? req.body.to.trim().toLowerCase() : "";
  const recipient = to ? await getRecipient(to) : null;
  if (to && !recipient) return res.status(404).json({ message: "Receiver user not found" });
  const result = await createDraft(
    user.id,
    recipient?.id ?? null,
    user.email,
    recipient?.email ?? "",
    typeof req.body.subject === "string" ? req.body.subject.trim() : "",
    typeof req.body.body === "string" ? req.body.body.trim() : ""
  );
  return res.status(201).json({ message: "Draft created successfully", draftId: result.insertId });
});

export const updateDraftMail = expressAsyncHandler(async (req, res) => {
  const draft = await findOwnedDraft(req.params.mailId, req.user.id);
  if (!draft) return res.status(404).json({ message: "Draft not found" });

  let recipientId = draft.receiver_user_id;
  let toEmail = draft.to_email;
  if (req.body.to !== undefined) {
    const to = typeof req.body.to === "string" ? req.body.to.trim().toLowerCase() : "";
    const recipient = to ? await getRecipient(to) : null;
    if (to && !recipient) return res.status(404).json({ message: "Receiver user not found" });
    recipientId = recipient?.id ?? null;
    toEmail = recipient?.email ?? "";
  }

  await updateDraft(
    draft.id,
    req.user.id,
    recipientId,
    toEmail,
    req.body.subject !== undefined ? String(req.body.subject).trim() : draft.subject,
    req.body.body !== undefined ? String(req.body.body).trim() : draft.body
  );
  const updatedDraft = await findOwnedDraft(draft.id, req.user.id);
  return res.status(200).json({ message: "Draft updated successfully", draft: updatedDraft });
});

export const listDraftMails = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getDraftMails(req.user.id, limit, offset);
  return res.status(200).json({
    drafts: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const removeDraftMail = expressAsyncHandler(async (req, res) => {
  const result = await deleteDraft(req.params.mailId, req.user.id);
  if (result.affectedRows === 0) return res.status(404).json({ message: "Draft not found" });
  return res.status(200).json({ message: "Draft deleted successfully" });
});

export const sendDraftMail = expressAsyncHandler(async (req, res) => {
  const result = await sendDraft(req.params.mailId, req.user.id);
  if (result.status === "not_found") return res.status(404).json({ message: "Draft not found" });
  if (result.status === "incomplete") return res.status(400).json({ message: "Draft requires receiver, subject, and body" });
  return res.status(200).json({ message: "Draft sent successfully", mailId: result.mailId });
});

const validateScheduledAt = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? null : date;
};

export const scheduleMail = expressAsyncHandler(async (req, res) => {
  const { to, subject, body, scheduledAt } = req.body;
  if (!to?.trim() || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ message: "Receiver, subject, and body are required" });
  }
  const scheduleDate = validateScheduledAt(scheduledAt);
  if (!scheduleDate) return res.status(400).json({ message: "A future scheduledAt value is required" });
  const user = await getCurrentUser(req, res);
  if (!user) return;
  const recipient = await getRecipient(to);
  if (!recipient) return res.status(404).json({ message: "Receiver user not found" });
  const result = await createScheduledMail(
    user.id,
    recipient.id,
    user.email,
    recipient.email,
    subject.trim(),
    body.trim(),
    scheduleDate
  );
  return res.status(201).json({ message: "Mail scheduled successfully", mailId: result.insertId });
});

export const listScheduledMails = expressAsyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const { mails, totalMails } = await getScheduledMails(req.user.id, limit, offset);
  return res.status(200).json({
    scheduledMails: mails,
    pagination: paginationResponse(page, limit, totalMails),
  });
});

export const rescheduleMail = expressAsyncHandler(async (req, res) => {
  const mail = await findOwnedScheduledMail(req.params.mailId, req.user.id);
  if (!mail) return res.status(404).json({ message: "Scheduled mail not found" });

  let receiverId = mail.receiver_user_id;
  let toEmail = mail.to_email;
  if (req.body.to !== undefined) {
    const recipient = await getRecipient(req.body.to);
    if (!recipient) return res.status(404).json({ message: "Receiver user not found" });
    receiverId = recipient.id;
    toEmail = recipient.email;
  }
  const scheduleDate = req.body.scheduledAt !== undefined
    ? validateScheduledAt(req.body.scheduledAt)
    : new Date(mail.scheduled_at);
  if (!scheduleDate) return res.status(400).json({ message: "A future scheduledAt value is required" });

  await updateScheduledMail(
    mail.id,
    req.user.id,
    receiverId,
    toEmail,
    req.body.subject !== undefined ? String(req.body.subject).trim() : mail.subject,
    req.body.body !== undefined ? String(req.body.body).trim() : mail.body,
    scheduleDate
  );
  const updatedMail = await findOwnedScheduledMail(mail.id, req.user.id);
  return res.status(200).json({ message: "Scheduled mail updated successfully", mail: updatedMail });
});

export const cancelSchedule = expressAsyncHandler(async (req, res) => {
  const result = await cancelScheduledMail(req.params.mailId, req.user.id);
  if (result.affectedRows === 0) return res.status(404).json({ message: "Scheduled mail not found" });
  return res.status(200).json({ message: "Scheduled mail cancelled successfully" });
});

export const replyToMail = expressAsyncHandler(async (req, res) => {
  const original = await getAuthorizedMail(req, res);
  if (!original) return;
  if (!req.body.body?.trim()) return res.status(400).json({ message: "Reply body is required" });

  const currentUser = await getCurrentUser(req, res);
  if (!currentUser) return;
  const recipientId = original.mailbox_role === "sender"
    ? original.receiver_user_id
    : original.sender_user_id;
  const recipient = await findUserById(recipientId);
  if (!recipient) return res.status(404).json({ message: "Reply recipient not found" });

  const threadId = original.thread_id || `thread-${original.id}`;
  if (!original.thread_id) await setMailThreadId(original.id, threadId);
  const subject = req.body.subject?.trim() ||
    (original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`);
  const result = await createMail(
    currentUser.id,
    recipient.id,
    currentUser.email,
    recipient.email,
    null,
    null,
    subject,
    req.body.body.trim(),
    "sent",
    threadId
  );
  return res.status(201).json({ message: "Reply sent successfully", mailId: result.insertId, threadId });
});

export const replyAllToMail = expressAsyncHandler(async (req, res) => {
  if (typeof req.body.body !== "string" || !req.body.body.trim()) {
    return res.status(400).json({ message: "Reply body is required" });
  }

  const currentUser = await getCurrentUser(req, res);
  if (!currentUser) return;

  const result = await createReplyAllMail(
    req.params.mailId,
    req.user.id,
    currentUser.email,
    req.body.subject,
    req.body.body.trim()
  );

  if (result.status === "forbidden") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (result.status === "not_found") {
    return res.status(404).json({ message: "Mail not found" });
  }
  if (result.status === "no_recipients") {
    return res.status(400).json({
      message: "Reply All has no valid recipients",
    });
  }

  return res.status(201).json({
    message: "Reply All sent successfully",
    mailId: result.mailId,
    threadId: result.threadId,
  });
});

export const forwardMail = expressAsyncHandler(async (req, res) => {
  const original = await getAuthorizedMail(req, res);
  if (!original) return;
  const recipient = await getRecipient(req.body.to);
  if (!recipient) return res.status(404).json({ message: "Receiver user not found" });
  const currentUser = await getCurrentUser(req, res);
  if (!currentUser) return;
  const subject = req.body.subject?.trim() ||
    (original.subject.startsWith("Fwd:") ? original.subject : `Fwd: ${original.subject}`);
  const body = req.body.body?.trim() || original.body;
  const result = await createMail(
    currentUser.id,
    recipient.id,
    currentUser.email,
    recipient.email,
    null,
    null,
    subject,
    body,
    "sent"
  );
  return res.status(201).json({ message: "Mail forwarded successfully", mailId: result.insertId });
});
