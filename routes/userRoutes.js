import express from "express";
import passport from "../config/passport.js";

import {
  createUser,
  updateUser,
  loginUser,
  deleteUser,
  getUserDetails,
  forgetPassword,
  passwordReset,
  resetPassword,
  logoutUser,
  getUsers,
  findUsers,
  changePassword,
  googleLogin,
  googleLoginFailed,
  unlinkGoogle

} from "../controllers/userControllers.js";

import checkToken from "../middleware/CheckToken.js";
import upload from "../middleware/upload.js";


const router = express.Router();

router.post("/create", createUser);
// router.put("/update", checkToken, updateUser);
router.put(
  "/update",
  checkToken,
  upload.single("profilePic"),
  updateUser
);
router.delete("/delete", checkToken, deleteUser);
router.post("/login", loginUser);
router.get("/getuser", checkToken, getUserDetails);
router.post("/forgetPassword", forgetPassword);
router.get("/resetToken/:token", resetPassword);
router.post("/resetToken/:token", passwordReset);
router.post("/logout", checkToken, logoutUser);
router.get("/all", checkToken, getUsers);
router.get("/search", checkToken, findUsers);
router.put("/change-password", checkToken, changePassword);

// Google OAuth
router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);


// router.get("/auth/google/callback",passport.authenticate("google", {session: false,failureRedirect: "/users/login",}),googleLogin);
router.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/users/auth/google/failed",
  }),
  googleLogin
);

router.get(
  "/auth/google/failed",
  googleLoginFailed
);

router.put("/unlink-google", checkToken, unlinkGoogle);

export default router;