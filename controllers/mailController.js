const MailCollection = require("../models/Mail");
const UserCollection = require("../models/User");

exports.sendMail = async (req, res) => {
  const { to, body, file, subject } = req.body;

  try {
    const { email } = req.user;
    let user = await UserCollection.findOne({ email });
    let friend = await UserCollection.findOne({ email:to });
    let data = await MailCollection.create({
      from:email,
      to,
      body,
      file,
      subject,
    });

    user.sendMail.push(data._id);
    friend.recivedMail.push(data._id);

    await user.save();
    await friend.save();

    res.status(201).json({ message: "email sent successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "error in sending mail", error: error.message });
  }
};
exports.getSentMail = async(req,res)=>{
const {_id,email} = req.user;


try {
  // let sentMails = await MailCollection.find({from:email})
  let user = await UserCollection.findOne({email}).populate('sendMail')
res.status(200).json({sentMails:user.sendMail})
} catch (error) {
  res.status(500).json({error:error.message,message:"error in getting"})

}

}
exports.getRecivedMail = async(req,res)=>{
  const {_id,email} = req.user;

  try {
    // let sentMails = await MailCollection.find({from:email})
    let user = await UserCollection.findOne({email}).populate('recivedMail')
  res.status(200).json({sentMails:user.recivedMail})
  } catch (error) {
    res.status(500).json({error:error.message,message:"error in getting"})
  
  }

}

exports.deleteSentMail = async (req, res) => {
  let _id = req.params._id;
  let { email } = req.user;

  try {
    let user = await UserCollection.findOne({ email });
    user.sendMail.pull(_id);
    await user.save();
    res.status(200).json({ message: "mail deleting successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "error in deleting mail", error: error.message });
  }
};

exports.deleteRecivedMail = async (req, res) => {
  let _id = req.params._id;
  let { email } = req.user;

  try {
    let user = await UserCollection.findOne({ email });
    user.recivedMail.pull(_id);

    await user.save();
    res.status(200).json({ message: "mail deleting successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "error in deleting mail", error: error.message });
  }
};
