let UserCollection = require('../models/User')
let bcrypt = require('bcryptjs')
const salt = bcrypt.genSaltSync(10)
const jwt = require('jsonwebtoken');
var randomstring = require("randomstring");
const nodemailer = require("nodemailer");
const { json } = require('express');



exports.createUser = async (req, res) => {
  // res.send('register running')
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'all fields are required' });
  }
  let checkUser = await UserCollection.findOne({ email })
  if (checkUser) {
    return res.status(403).json({ message: 'user already register' })
  }
  try {
    let data = await UserCollection.create({
      name,
      email,
      password
    })
    res.status(201).json({ message: 'user created successfully' })
  } catch (error) {
    res.status(500).json({ message: 'error in register user', error: error.message })
  }

}


exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    let user = await UserCollection.findOne({ email })
    if (user) {

      let comparesPassword = bcrypt.compareSync(password, user.password)

      if (comparesPassword) {
        let token = jwt.sign({ _id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({ message: "login successfully", token, expiresIn: '1d' })

      } else {
        res.status(401).json({ message: "wrong password" })
      }
    } else {
      return res.status(404).json({ message: 'user not found' })
    }

  } catch (error) {
    res.status(500).json({ message: 'error in login user', error: error.message })
  }


}

exports.forgetPassword = async (req, res) => {
  const { email } = req.body
  try {
    let user = await UserCollection.findOne({ email })
    if(user){
      let resetToken=randomstring.generate(30)
      user.resetPasswordToken=resetToken
      await user.save()
      const mail=await sendEmail(email,resetToken)
      res.status(201).json({
        msg:"please check your email for reset password",
        success:true

      })
    }
    else{
      res.status(500).json({msg:"email does not exist",success:false})
    }
  } catch (error) {
    res.status(500).json({
      msg:"error in forgot password",success:false,error:error.message
    })
  }
};

function sendEmail(email, resetToken) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "sinhaswitu154@gmail.com",
      pass: "uwfs qhwk dxtt tvxt",
    },
  });
  async function main() {
    const info = await transporter.sendMail({
      from: "sinhaswitu154@gmail.com",
      to: email,
      subject: "Password reset Request",
      text: `Please click the link below to choose a new password: \n "http://localhost:8081/users/resetToken/${resetToken}`,
    });
    console.log("Message sent: %s", info.messageId);
  }

  main().catch(console.error);
}
 
exports.resetPsssword = async (req, res) => {
  let token = req.params.token
  let user = await UserCollection.findOne({ resetPasswordToken: token });
  if(user){
    res.render('resetPassword', { token })
  }
  else{
    res.status(500).json("token expire")
  }
  
}

exports.passwordReset = async (req, res) => {
  let token = req.params.token;
  let newPassword = req.body.newPassword;

  try {
    let user = await UserCollection.findOne({ resetPasswordToken: token });
    
    if (user) {
      user.password = newPassword;
      user.resetPasswordToken = null;
      await user.save();
      res.json({ msg: "password updated  successfully", success: true });
    } else {
      res.json({ msg: "token expired", success: false });
    }
  } catch (error) {
    res.json({
      msg: "error in password reset",
      success: false,
      error: error.message,
    });
  }
}

exports.updateUser = async (req, res) => {
  const { name, password,profilePic } = req.body;
  const { _id, email } = req.user;
  console.log("_id",_id)
  try {
    let user = await UserCollection.findById(_id)
    if (user) {
      if (name) {
        user.name = name

      }
      if (password) {
        user.password = password
      } if(profilePic) {
        user.profilePic = profilePic
      }
      await user.save()
    } else {
      res.status(400).json({ message: 'user not found' })
    }
    res.status(200).json({ message: 'user updated successfully' })

  } catch (error) {
    res.status(500).json({ message: 'error in updating user', error: error.message })
  }

}

exports.deleteUser = async (req, res) => {
  const { _id } = req.user
  try {
    await UserCollection.findByIdAndDelete(_id)
    res.status(200).json({ message: 'account deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'error in deleting user', error: error.message })
  }

}

exports.getUserDetails = async (req, res) => {
  const { _id } = req.user;
  try {
    let user = await UserCollection.findById(_id)
    res.status(200).json({ message: 'successfully', user })
  } catch (error) {
    res.status(500).json({ error: error.message, message: 'error in getting user' })
  }
}
