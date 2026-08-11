import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const uploadRoot = path.resolve("uploads");

const getSafeExtension = (fileName) => {
  const extension = path.extname(path.basename(fileName || ""));
  return /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : "";
};

export const resolveAttachmentPath = (storedPath) => {
  if (typeof storedPath !== "string" || !storedPath.trim()) {
    throw new Error("Invalid attachment path");
  }

  const resolvedPath = path.resolve(storedPath);
  const relativePath = path.relative(uploadRoot, resolvedPath);
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Unsafe attachment path");
  }

  return resolvedPath;
};

export const persistAttachmentFile = async (file) => {
  if (!Buffer.isBuffer(file?.buffer)) {
    throw new Error("Invalid attachment upload");
  }

  await fs.mkdir(uploadRoot, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomUUID()}${getSafeExtension(file.originalname)}`;
  const absolutePath = resolveAttachmentPath(path.join(uploadRoot, storedName));
  try {
    await fs.writeFile(absolutePath, file.buffer, { flag: "wx" });
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }

  return {
    fileName: path.basename(file.originalname || "attachment"),
    filePath: path.relative(process.cwd(), absolutePath).split(path.sep).join("/"),
    fileSize: file.size,
    fileType: file.mimetype,
    absolutePath,
  };
};

export const removeAttachmentFile = async (storedPath) => {
  const absolutePath = resolveAttachmentPath(storedPath);
  try {
    await fs.unlink(absolutePath);
    return { removed: true, alreadyMissing: false };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { removed: false, alreadyMissing: true };
    }
    throw error;
  }
};

export const cleanupAttachmentFiles = async (files) => {
  await Promise.allSettled(
    files.map((file) => removeAttachmentFile(file.filePath))
  );
};
