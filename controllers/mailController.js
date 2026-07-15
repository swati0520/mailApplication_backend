import MailCollection from "../models/Mail.js";
import UserCollection from "../models/User.js";

export const sendMail = async (req, res) => {
  try {
    const { to, body, file, subject } = req.body;
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

    const user = await UserCollection.findOne({
      email: normalizedSenderEmail,
    });

    if (!user) {
      return res.status(404).json({
        message: "Sender user not found",
      });
    }

    const friend = await UserCollection.findOne({
      email: normalizedReceiverEmail,
    });

    if (!friend) {
      return res.status(404).json({
        message: "Receiver user not found",
      });
    }

    const data = await MailCollection.create({
      from: normalizedSenderEmail,
      to: normalizedReceiverEmail,
      body: body.trim(),
      file,
      subject: subject.trim(),
    });

    user.sendMail.push(data._id);
    friend.recivedMail.push(data._id);

    await Promise.all([
      user.save(),
      friend.save(),
    ]);

    return res.status(201).json({
      message: "Email sent successfully",
      mail: data,
    });
  } catch (error) {

    return res.status(500).json({
      message: "Error in sending mail",
      error: error.message,
    });
  }
};
export const getSentMail = async (req, res) => {

  try {

    const email = req.user?.email;



    if (!email) {

      return res.status(401).json({

        message: "Unauthorized user",

      });

    }



    const user = await UserCollection.findOne({

      email: email.trim().toLowerCase(),

    }).populate("sendMail");



    if (!user) {

      return res.status(404).json({

        message: "User not found",

      });

    }



    return res.status(200).json({

      sentMails: user.sendMail,

    });

  } catch (error) {

    return res.status(500).json({

      message: "Error in getting sent mails",

      error: error.message,

    });

  }

};

export const getRecivedMail = async (req, res) => {

  try {

    const email = req.user?.email;



    if (!email) {

      return res.status(401).json({

        message: "Unauthorized user",

      });

    }



    const user = await UserCollection.findOne({

      email: email.trim().toLowerCase(),

    }).populate("recivedMail");



    if (!user) {

      return res.status(404).json({

        message: "User not found",

      });

    }



    return res.status(200).json({

      receivedMails: user.recivedMail,

    });

  } catch (error) {

    return res.status(500).json({

      message: "Error in getting received mails",

      error: error.message,

    });

  }

};

export const deleteSentMail = async (req, res) => {

  try {

    const mailId = req.params._id;

    const email = req.user?.email;



    if (!email) {

      return res.status(401).json({

        message: "Unauthorized user",

      });

    }



    const user = await UserCollection.findOne({

      email: email.trim().toLowerCase(),

    });



    if (!user) {

      return res.status(404).json({

        message: "User not found",

      });

    }



    user.sendMail.pull(mailId);

    await user.save();



    return res.status(200).json({

      message: "Mail deleted successfully",

    });

  } catch (error) {

    return res.status(500).json({

      message: "Error in deleting mail",

      error: error.message,

    });

  }

};

export const deleteRecivedMail = async (req, res) => {

  try {

    const mailId = req.params._id;

    const email = req.user?.email;



    if (!email) {

      return res.status(401).json({

        message: "Unauthorized user",

      });

    }



    const user = await UserCollection.findOne({

      email: email.trim().toLowerCase(),

    });



    if (!user) {

      return res.status(404).json({

        message: "User not found",

      });

    }



    user.recivedMail.pull(mailId);

    await user.save();



    return res.status(200).json({

      message: "Mail deleted successfully",

    });

  } catch (error) {

    return res.status(500).json({

      message: "Error in deleting mail",

      error: error.message,

    });

  }

};
