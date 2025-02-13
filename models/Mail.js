const mongoose = require("mongoose");
const mailSchema = new mongoose.Schema({
  from: {
    type: String,
    required: true,
  },
  to: {
    type: String,
    required: true,
  },
  subject: {
    type:String,
  },
  body: {
    type: String,
    required: true,
  },
  file: {
    type: String,
  },
},{timestamps:true});


module.exports = mongoose.model('mails',mailSchema)
