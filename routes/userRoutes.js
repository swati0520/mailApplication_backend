import express from "express";

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
} from "../controllers/userControllers.js";

import checkToken from "../middleware/CheckToken.js";

const router = express.Router();

router.post("/create", createUser);
router.put("/update", checkToken, updateUser);
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
export default router;