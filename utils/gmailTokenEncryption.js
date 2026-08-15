import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TOKEN_FORMAT_VERSION = "v1";

const getEncryptionKey = () => {
  const configuredKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim();

  if (!configuredKey) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured");
  }

  const key = Buffer.from(configuredKey, "base64");

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    );
  }

  return key;
};

export const encryptGmailRefreshToken = (refreshToken) => {
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error("A Gmail refresh token is required");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encryptedToken = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    TOKEN_FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    encryptedToken.toString("base64"),
  ].join(":");
};

export const decryptGmailRefreshToken = (encryptedRefreshToken) => {
  if (typeof encryptedRefreshToken !== "string") {
    throw new Error("An encrypted Gmail refresh token is required");
  }

  const [version, encodedIv, encodedAuthTag, encodedToken, ...extraParts] =
    encryptedRefreshToken.split(":");

  if (
    version !== TOKEN_FORMAT_VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedToken ||
    extraParts.length
  ) {
    throw new Error("Encrypted Gmail refresh token has an invalid format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedToken, "base64")),
    decipher.final(),
  ]).toString("utf8");
};
