import express from "express";

import {
  createUser,
  updateUser,
  loginUser,
  deleteUser,
  getUserDetails,
  forgetPassword,
  resetPsssword,
  passwordReset,
} from "../controllers/userControllers.js";

import checkToken from "../middleware/CheckToken.js";

const router = express.Router();

router.post("/create", createUser);
router.put("/update", checkToken, updateUser);
router.delete("/delete", checkToken, deleteUser);
router.post("/login", loginUser);
router.get("/getuser", checkToken, getUserDetails);
router.post("/forgetPassword", forgetPassword);
router.get("/resetToken/:token", resetPsssword);
router.post("/resetToken/:token", passwordReset);

export default router;