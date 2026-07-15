import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import randomstring from "randomstring";
import nodemailer from "nodemailer";

import UserCollection from "../models/User.js";

export const createUser = async (req, res) => {

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


export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email?.trim() || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await UserCollection.findOne({
      email: normalizedEmail,
    }).select("+password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        message: "Wrong password",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      {
        _id: user._id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      expiresIn: "1d",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePic: user.profilePic,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error in login user",
      error: error.message,
    });
  }
};

export const forgetPassword = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email?.trim()) {
      return res.status(400).json({
        msg: "Email is required",
        success: false,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await UserCollection.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(404).json({
        msg: "Email does not exist",
        success: false,
      });
    }

    const resetToken = randomstring.generate(30);

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;

    await user.save();

    await sendEmail(normalizedEmail, resetToken);

    return res.status(200).json({
      msg: "Please check your email to reset your password",
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      msg: "Error in forgot password",
      success: false,
      error: error.message,
    });
  }
};

const sendEmail = async (email, resetToken) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });

  const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset Request",
    text: `Please click the link below to reset your password:\n${resetLink}`,
  });

  return info;
};

export const resetPsssword = async (req, res) => {
  let token = req.params.token
  let user = await UserCollection.findOne({ resetPasswordToken: token });
  if (user) {
    res.render('resetPassword', { token })
  }
  else {
    res.status(500).json("token expire")
  }

}

export const passwordReset = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  try {
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        msg: "Password must be at least 8 characters",
        success: false,
      });
    }

    const user = await UserCollection.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: {
        $gt: Date.now(),
      },
    });

    if (!user) {
      return res.status(400).json({
        msg: "Reset token is invalid or expired",
        success: false,
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    return res.status(200).json({
      msg: "Password updated successfully",
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      msg: "Error in password reset",
      success: false,
      error: error.message,
    });
  }
};

export const updateUser = async (req, res) => {
  const { name, password, profilePic } = req.body;
  const { _id, email } = req.user;
  try {
    let user = await UserCollection.findById(_id)
    if (user) {
      if (name) {
        user.name = name

      }
      if (password) {
        user.password = password
      } if (profilePic) {
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

export const deleteUser = async (req, res) => {
  const { _id } = req.user
  try {
    await UserCollection.findByIdAndDelete(_id)
    res.status(200).json({ message: 'account deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'error in deleting user', error: error.message })
  }

}

export const getUserDetails = async (req, res) => {
  const { _id } = req.user;
  try {
    let user = await UserCollection.findById(_id)
    res.status(200).json({ message: 'successfully', user })
  } catch (error) {
    res.status(500).json({ error: error.message, message: 'error in getting user' })
  }
}
