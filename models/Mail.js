import mongoose from "mongoose";
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

const Mail = mongoose.model("mails", mailSchema);

export default Mail
