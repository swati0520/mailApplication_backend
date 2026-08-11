import cloudinary from "../config/cloudinary.js";

export const uploadToCloudinary = (filePath, folder = "profile") =>
  cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: "image",
  });

export const deleteFromCloudinary = (publicId) =>
  cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
  });
