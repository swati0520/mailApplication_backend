import { randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";
const STATE_LIFETIME_SECONDS = 10 * 60;
const STATE_PURPOSE = "gmail-oauth-connect";

const getStateSecret = () => {
  const secret = process.env.GMAIL_OAUTH_STATE_SECRET?.trim();

  if (!secret) {
    throw new Error("GMAIL_OAUTH_STATE_SECRET is not configured");
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("GMAIL_OAUTH_STATE_SECRET must be at least 32 bytes");
  }

  return secret;
};

export const gmailOAuthStateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/gmail/callback",
  maxAge: STATE_LIFETIME_SECONDS * 1000,
};

export const gmailOAuthStateClearOptions = {
  httpOnly: gmailOAuthStateCookieOptions.httpOnly,
  secure: gmailOAuthStateCookieOptions.secure,
  sameSite: gmailOAuthStateCookieOptions.sameSite,
  path: gmailOAuthStateCookieOptions.path,
};

export const createGmailOAuthState = (userId) => {
  const state = randomBytes(32).toString("base64url");
  const stateCookie = jwt.sign(
    {
      purpose: STATE_PURPOSE,
      userId: String(userId),
      state,
    },
    getStateSecret(),
    { expiresIn: STATE_LIFETIME_SECONDS }
  );

  return { state, stateCookie };
};

const safelyEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const validateGmailOAuthState = ({ state, stateCookie, userId }) => {
  if (
    typeof state !== "string" ||
    !state ||
    typeof stateCookie !== "string" ||
    !stateCookie
  ) {
    throw new Error("Invalid Gmail OAuth state");
  }

  let payload;

  try {
    payload = jwt.verify(stateCookie, getStateSecret());
  } catch {
    throw new Error("Invalid or expired Gmail OAuth state");
  }

  if (
    payload.purpose !== STATE_PURPOSE ||
    payload.userId !== String(userId) ||
    typeof payload.state !== "string" ||
    !safelyEqual(payload.state, state)
  ) {
    throw new Error("Invalid Gmail OAuth state");
  }

  return true;
};
