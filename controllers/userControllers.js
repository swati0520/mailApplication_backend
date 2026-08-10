import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import randomstring from "randomstring";
import nodemailer from "nodemailer";
import expressAsyncHandler from "express-async-handler";
import {
  findUserByEmail,
  createUser as createUserQuery,
  updateResetToken,
  findUserByResetToken,
  findValidResetToken,
  updatePassword,
  findUserById,
  updateUserQuery,
  deleteUserQuery,
  getAllUsers,
  searchUsers,
  unlinkGoogleAccount
} from "../models/User.js";
import { setAuthCookie } from "../utils/authCookie.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";


export const createUser = expressAsyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({
      message: "All fields are required",
    });
  }

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const checkUser = await findUserByEmail(normalizedEmail);

  if (checkUser) {
    return res.status(403).json({
      message: "User already registered",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await createUserQuery(
    trimmedName,
    normalizedEmail,
    hashedPassword
  );

  return res.status(201).json({
    message: "User created successfully",
  });
});


export const loginUser = expressAsyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password) {
    return res.status(400).json({
      message: "Email and password are required",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await findUserByEmail(normalizedEmail);

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
      message: "Invalid email or password",
    });
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "365d",
    }
  );

  setAuthCookie(res, token);

  return res.status(200).json({
    message: "Login successful",
    expiresIn: "365d",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      profilePic: user.profile_pic,
    },
  });
});

export const forgetPassword = expressAsyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({
      msg: "Email is required",
      success: false,
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    return res.status(404).json({
      msg: "Email does not exist",
      success: false,
    });
  }

  const resetToken = randomstring.generate(30);
  const resetPasswordExpires = new Date(
    Date.now() + 15 * 60 * 1000
  );

  await updateResetToken(
    user.id,
    resetToken,
    resetPasswordExpires
  );

  await sendEmail(normalizedEmail, resetToken);

  return res.status(200).json({
    msg: "Please check your email to reset your password",
    success: true,
  });
});

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

  await transporter.verify();


  const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset Request",
    text: `Please click the link below to reset your password:\n${resetLink}`,
  });

  return info;
};

export const resetPassword = expressAsyncHandler(async (req, res) => {
  const token = req.params.token
  const user = await findUserByResetToken(token)
  if (user) {
    return res.render("resetPassword", { token });
  }

  return res.status(400).json({
    message: "Token expired",
  });

})


export const passwordReset = expressAsyncHandler(async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({
      msg: "Password must be at least 8 characters",
      success: false,
    });
  }

  const user = await findValidResetToken(token);

  if (!user) {
    return res.status(400).json({
      msg: "Reset token is invalid or expired",
      success: false,
    });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await updatePassword(user.id, hashedPassword);

  return res.status(200).json({
    msg: "Password updated successfully",
    success: true,
  });
});

export const updateUser = expressAsyncHandler(async (req, res) => {
  const { name, password } = req.body;
  const { id } = req.user;

  const user = await findUserById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  let hashedPassword = user.password;
  let profilePic = user.profile_pic;

  // Password update
  if (password) {
    hashedPassword = await bcrypt.hash(password, 10);
  }

  // Profile image upload
  if (req.file) {
    const result = await uploadToCloudinary(
      req.file.buffer,
      "profile"
    );

    profilePic = result.secure_url;
  }

  await updateUserQuery(
    id,
    name || user.name,
    hashedPassword,
    profilePic
  );

  return res.status(200).json({
    message: "User updated successfully",
    user: {
      id: user.id,
      name: name || user.name,
      email: user.email,
      profilePic,
    },
  });
});

export const deleteUser = expressAsyncHandler(async (req, res) => {
  const { id } = req.user;

  await deleteUserQuery(id);

  return res.status(200).json({
    message: "Account deleted successfully",
  });
});



export const getUserDetails = expressAsyncHandler(async (req, res) => {
  const { id } = req.user;

  const user = await findUserById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const { password, ...userWithoutPassword } = user;

  return res.status(200).json({
    message: "User fetched successfully",
    user: userWithoutPassword,
  });
});

export const logoutUser = expressAsyncHandler(async (req, res) => {
   res.clearCookie("token", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  });

  return res.status(200).json({
    message: "Logout successful",
  });
});



export const getUsers = expressAsyncHandler(async (req, res) => {
  const users = await getAllUsers();

  return res.status(200).json({
    message: "Users fetched successfully",
    users,
  });
});

export const findUsers = expressAsyncHandler(async (req, res) => {
  const { search } = req.query;

  if (!search?.trim()) {
    return res.status(400).json({
      message: "Search value is required",
    });
  }

  const users = await searchUsers(search.trim());

  return res.status(200).json({
    message: "Users fetched successfully",
    users,
  });
});

export const changePassword = expressAsyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { id } = req.user;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      message: "Current password and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      message: "New password must be at least 8 characters",
    });
  }

  const user = await findUserById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const isPasswordCorrect = await bcrypt.compare(
    currentPassword,
    user.password
  );

  if (!isPasswordCorrect) {
    return res.status(401).json({
      message: "Current password is incorrect",
    });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await updatePassword(id, hashedPassword);

  return res.status(200).json({
    message: "Password changed successfully",
  });
});



export const googleLogin = expressAsyncHandler(async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      message: "JWT_SECRET is not configured",
    });
  }

  const token = jwt.sign(
    {
      id: req.user.id,
      email: req.user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

  setAuthCookie(res, token);

  return res.status(200).json({
    message: "Google login successful",
    expiresIn: "1d",
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      profilePic: req.user.profile_pic,
    },
  });
});

export const googleLoginFailed = expressAsyncHandler(async (req, res) => {
  return res.status(401).json({
    message: "Google authentication failed",
  });
});

export const unlinkGoogle = expressAsyncHandler(async (req, res) => {
  const { id } = req.user;

  const user = await findUserById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  if (!user.password) {
    return res.status(400).json({
      message: "Set a password before unlinking your Google account",
    });
  }

  if (!user.google_id) {
    return res.status(400).json({
      message: "Google account is not linked",
    });
  }

  await unlinkGoogleAccount(id);

  return res.status(200).json({
    message: "Google account unlinked successfully",
  });
});