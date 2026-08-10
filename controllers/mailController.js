import expressAsyncHandler from "express-async-handler";
import {
  createMail,
  getSentMails,
  getInboxMails,
  deleteSentMailQuery,
  deleteReceivedMailQuery,
  findMailById,
  markMailAsRead,
  markMailAsStarred,
  markMailAsImportant,
  markMailAsArchived,
  markMailAsSpam,
  getAllMails,
} from "../models/Mail.js";

import {
  findUserByEmail,
} from "../models/User.js";

const getAuthorizedMail = async (
  req,
  res,
  { ownerField, notFoundMessage = "Mail not found" } = {}
) => {
  const mailId = req.params.mailId ?? req.params._id;

  const mail = await findMailById(mailId);

  if (!mail) {
    res.status(404).json({
      message: notFoundMessage,
    });
    return null;
  }

  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      message: "Unauthorized user",
    });
    return null;
  }

  // Delete endpoint ke liye specific owner check
  if (ownerField) {
    const isOwner =
      String(mail[ownerField]) === String(userId);

    if (!isOwner) {
      res.status(403).json({
        message: "Forbidden",
      });
      return null;
    }

    // Check user's own deletion state
    const deletedField =
      ownerField === "sender_user_id"
        ? "sender_is_deleted"
        : "receiver_is_deleted";

    if (mail[deletedField]) {
      res.status(404).json({
        message: notFoundMessage,
      });
      return null;
    }

    return mail;
  }

  // General mail access
  const isSender =
    String(mail.sender_user_id) === String(userId);

  const isReceiver =
    String(mail.receiver_user_id) === String(userId);

  if (!isSender && !isReceiver) {
    res.status(403).json({
      message: "Forbidden",
    });
    return null;
  }

  // User ki side se mail already deleted hai ya nahi
  if (isSender && mail.sender_is_deleted) {
    res.status(404).json({
      message: notFoundMessage,
    });
    return null;
  }

  if (isReceiver && mail.receiver_is_deleted) {
    res.status(404).json({
      message: notFoundMessage,
    });
    return null;
  }

  return mail;
};



export const sendMail = expressAsyncHandler(async (req, res) => {
  const { to, body, subject } = req.body;
  const senderEmail = req.user?.email;

  if (!senderEmail) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  if (!to?.trim()) {
    return res.status(400).json({
      message: "Receiver email is required",
    });
  }

  if (!subject?.trim()) {
    return res.status(400).json({
      message: "Subject is required",
    });
  }

  if (!body?.trim()) {
    return res.status(400).json({
      message: "Mail body is required",
    });
  }

  const normalizedSenderEmail = senderEmail.trim().toLowerCase();
  const normalizedReceiverEmail = to.trim().toLowerCase();

  const user = await findUserByEmail(normalizedSenderEmail);

  if (!user) {
    return res.status(404).json({
      message: "Sender user not found",
    });
  }

  const friend = await findUserByEmail(normalizedReceiverEmail);

  if (!friend) {
    return res.status(404).json({
      message: "Receiver user not found",
    });
  }

  const data = await createMail(
    user.id,
    friend.id,
    normalizedSenderEmail,
    normalizedReceiverEmail,
    null,
    null,
    subject.trim(),
    body.trim(),
    "sent"
  );

  return res.status(201).json({
    message: "Email sent successfully",
    mail: data,
  });
});

export const getSentMail = expressAsyncHandler(async (req, res) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  const user = await findUserByEmail(
    email.trim().toLowerCase()
  );

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const sentMails = await getSentMails(user.id);

  return res.status(200).json({
    sentMails,
  });
});

export const getRecivedMail = expressAsyncHandler(async (req, res) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).json({
      message: "Unauthorized user",
    });
  }

  const user = await findUserByEmail(
    email.trim().toLowerCase()
  );

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(req.query.limit) || 10, 1),
    50
  );

  const offset = (page - 1) * limit;

  const { mails, totalMails } = await getInboxMails(
    user.id,
    limit,
    offset
  );

  const totalPages = Math.ceil(totalMails / limit);

  return res.status(200).json({
    receivedMails: mails,
    pagination: {
      page,
      limit,
      totalMails,
      totalPages,
    },
  });
});

export const deleteSentMail = expressAsyncHandler(async (req, res) => {
  const mailId = req.params._id;
  const mail = await getAuthorizedMail(req, res, {
    ownerField: "sender_user_id",
  });

  if (!mail) return;

  await deleteSentMailQuery(mailId);

  return res.status(200).json({
    message: "Mail deleted successfully",
  });
});

export const deleteRecivedMail = expressAsyncHandler(async (req, res) => {
  const mailId = req.params._id;
  const mail = await getAuthorizedMail(req, res, {
    ownerField: "receiver_user_id",
  });

  if (!mail) return;

  await deleteReceivedMailQuery(mailId);

  return res.status(200).json({
    message: "Mail deleted successfully",
  });
});

export const getMailDetails = expressAsyncHandler(async (req, res) => {
  const mail = await getAuthorizedMail(req, res);

  if (!mail) return;

  return res.status(200).json({
    message: "Mail fetched successfully",
    mail,
  });
});

export const readMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;

  const mail = await getAuthorizedMail(req, res, {
    notFoundMessage: "Mail not found",
  });

  if (!mail) return;

  const result = await markMailAsRead(mailId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail marked as read successfully",
  });
});

export const starMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;
  const mail = await getAuthorizedMail(req, res);

  if (!mail) return;

  const result = await markMailAsStarred(mailId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail starred successfully",
  });
});

export const importantMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;
  const mail = await getAuthorizedMail(req, res);

  if (!mail) return;

  const result = await markMailAsImportant(mailId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail marked as important successfully",
  });
});

export const archiveMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;
  const mail = await getAuthorizedMail(req, res);

  if (!mail) return;

  const result = await markMailAsArchived(mailId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail archived successfully",
  });
});

export const spamMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;
  const mail = await getAuthorizedMail(req, res);

  if (!mail) return;

  const result = await markMailAsSpam(mailId);

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail marked as spam successfully",
  });
});

export const getAllMail = expressAsyncHandler(async (req, res) => {
  const mails = await getAllMails(req.user.id);

  return res.status(200).json({
    allMails: mails,
  });
});

