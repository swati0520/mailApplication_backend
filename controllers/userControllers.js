import bcrypt from "bcryptjs";
import expressAsyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import { unlink } from "node:fs/promises";
import nodemailer from "nodemailer";
import randomstring from "randomstring";
import {
  createUser as createUserQuery,
  deleteUserQuery,
  findUserByEmail,
  findUserById,
  findValidResetToken,
  getAllUsers,
  searchUsers,
  unlinkGoogleAccount,
  updatePassword,
  updateResetToken,
  updateUserQuery,
} from "../models/User.js";
import {
  clearAuthCookie,
  setAuthCookie,
} from "../utils/authCookie.js";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../utils/cloudinaryUpload.js";
import { findGmailConnectionByUserId } from "../models/GmailConnection.js";

const createAuthToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "365d",
    }
  );
};

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profilePic: user.profile_pic,
  isGoogleLinked: Boolean(user.google_id),
});

export const getGoogleLoginRedirect = ({
  gmailConnection,
  frontendUrl,
}) => gmailConnection?.connection_status === "connected"
  ? `${frontendUrl}/`
  : "/gmail/connect";

const removeLocalUpload = async (filePath) => {
  if (!filePath) return;

  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
};


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

  const isPasswordCorrect = user.password && await bcrypt.compare(
    password,
    user.password
  );

  if (!isPasswordCorrect) {
    return res.status(401).json({
      message: "Invalid email or password",
    });
  }

  const token = createAuthToken(user);

  setAuthCookie(res, token);

  return res.status(200).json({
    message: "Login successful",
    expiresIn: "365d",
    user: serializeUser(user),
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
  const { token } = req.params;
  const user = await findValidResetToken(token);

  if (user) {
    return res.render("resetPassword", { token });
  }

  return res.status(400).json({
    message: "Token expired",
  });
});


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
  const { name, email, password } = req.body;
  const { id } = req.user;
  const rejectUpdate = async (status, message) => {
    await removeLocalUpload(req.file?.path);
    return res.status(status).json({ message });
  };

  const user = await findUserById(id);

  if (!user) {
    return rejectUpdate(404, "User not found");
  }

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return rejectUpdate(400, "Name cannot be empty");
  }

  if (email !== undefined && (typeof email !== "string" || !email.trim())) {
    return rejectUpdate(400, "Email cannot be empty");
  }

  if (password) {
    return rejectUpdate(
      400,
      "Use the change-password endpoint to update your password"
    );
  }

  const updatedName = name?.trim() || user.name;
  const normalizedEmail = email?.trim().toLowerCase() || user.email;

  if (normalizedEmail !== user.email) {
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser && String(existingUser.id) !== String(id)) {
      return rejectUpdate(409, "Email is already in use");
    }
  }

  let profilePic = user.profile_pic;
  let uploadedImage;

  if (req.file) {
    if (!req.file.mimetype?.startsWith("image/")) {
      return rejectUpdate(400, "Profile picture must be an image");
    }

    try {
      uploadedImage = await uploadToCloudinary(req.file.path, "profile");
      profilePic = uploadedImage.secure_url;
    } catch (error) {
      return res.status(502).json({
        message: "Profile picture upload failed",
      });
    } finally {
      await removeLocalUpload(req.file.path);
    }
  }

  try {
    await updateUserQuery(
      id,
      updatedName,
      normalizedEmail,
      profilePic
    );
  } catch (error) {
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.public_id);
      } catch {
        // Preserve the database error if remote cleanup also fails.
      }
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Email is already in use",
      });
    }

    throw error;
  }

  const updatedUser = await findUserById(id);
  const token = createAuthToken(updatedUser);
  setAuthCookie(res, token);

  return res.status(200).json({
    message: "User updated successfully",
    expiresIn: "365d",
    user: serializeUser(updatedUser),
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

  return res.status(200).json({
    message: "User fetched successfully",
    user: serializeUser(user),
  });
});

export const logoutUser = expressAsyncHandler(async (req, res) => {
  clearAuthCookie(res);

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

  if (
    typeof currentPassword !== "string" ||
    !currentPassword ||
    typeof newPassword !== "string" ||
    !newPassword
  ) {
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

  if (!user.password) {
    return res.status(400).json({
      message: "Set a password before using password change",
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
  const token = createAuthToken(req.user);

  setAuthCookie(res, token);

  const gmailConnection = await findGmailConnectionByUserId(req.user.id);
  return res.redirect(getGoogleLoginRedirect({
    gmailConnection,
    frontendUrl: process.env.FRONTEND_URL,
  }));
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
