import crypto from "crypto";
import path from "path";
import multer from "multer";

const getSafeExtension = (fileName) => {
  const extension = path.extname(path.basename(fileName || ""));
  return /^\.[a-zA-Z0-9]{1,10}$/.test(extension)
    ? extension.toLowerCase()
    : "";
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${getSafeExtension(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
});

export default upload;
