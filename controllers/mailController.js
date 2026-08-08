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
} from "../models/Mail.js";

import {
  findUserByEmail,
} from "../models/User.js";



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

  const receivedMails = await getInboxMails(user.id);

  return res.status(200).json({
    receivedMails,
  });
});

export const deleteSentMail = expressAsyncHandler(async (req, res) => {
  const mailId = req.params._id;
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

  await deleteSentMailQuery(mailId);

  return res.status(200).json({
    message: "Mail deleted successfully",
  });
});

export const deleteRecivedMail = expressAsyncHandler(async (req, res) => {
  const mailId = req.params._id;
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

  await deleteReceivedMailQuery(mailId);

  return res.status(200).json({
    message: "Mail deleted successfully",
  });
});

export const getMailDetails = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;

  const mail = await findMailById(mailId);

  if (!mail) {
    return res.status(404).json({
      message: "Mail not found",
    });
  }

  return res.status(200).json({
    message: "Mail fetched successfully",
    mail,
  });
});

export const readMail = expressAsyncHandler(async(req,res)=> {
  const {mailId} = req.params;

  const result = await markMailAsRead(mailId)

  if (result.affectedRows === 0) {
    return res.status(404).json({
      message:"mail not found",

    })
     }

     return res.status(200).json({
    message: "Mail marked as read successfully",
  });
 
})

export const starMail = expressAsyncHandler(async (req, res) => {
  const { mailId } = req.params;

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
  console.log(mailId)

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

