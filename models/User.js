import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import validator from "validator";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [50, "Name cannot exceed 50 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      unique: true,
      lowercase: true,
      validate: {
        validator: validator.isEmail,
        message: "Please provide a valid email address",
      },
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    sendMail: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "mails",
        },
      ],
      default: [],
    },

    recivedMail: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "mails",
        },
      ],
      default: [],
    },

    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },

    profilePic: {
      type: String,
      trim: true,
      default:
        "https://img.freepik.com/premium-vector/profile-picture-icon-human-symbol-man-women-sign-people-person-user-profile-avatar-icon_659151-3962.jpg?w=740",
    },
  },
  {
    timestamps: true,
  }
);


userSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) {
      return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const UserCollection = mongoose.model("users", userSchema);

export default UserCollection;