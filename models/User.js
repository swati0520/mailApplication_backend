const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: true,
  
  },
  email: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    validate: {
      validator: validator.isEmail,
      message: 'Please provide a valid email address',
    },
  },
  password: {
    type: String,
    required: true,

  },



}, { timestamps: true });

userSchema.pre('save', function (next) {
  if (!this.isModified('password')) {
    return next()
  }
  const salt = bcrypt.genSaltSync(10);
  this.password = bcrypt.hashSync(this.password, salt)
  next()
})

userSchema.add({
  sendMail: {
    type: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "mails"
      }
    ],

  },
  recivedMail: {
    type: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "mails"
      }
    ],

  }
})
userSchema.add({
  resetPasswordToken: {
    type: String,
    default: null
  },
  profilePic:{
    type: String,
    default:"https://img.freepik.com/premium-vector/profile-picture-icon-human-symbol-man-women-sign-people-person-user-profile-avatar-icon_659151-3962.jpg?w=740"
  }

})

module.exports = mongoose.model('users', userSchema);


