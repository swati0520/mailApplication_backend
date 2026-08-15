import { google } from "googleapis";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_REQUIRED_SCOPES = [
  GMAIL_READONLY_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
];
export const GMAIL_OAUTH_SCOPES = ["openid", ...GMAIL_REQUIRED_SCOPES];

const requireEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
};

const validateCallbackUrl = (callbackUrl) => {
  let parsedUrl;

  try {
    parsedUrl = new URL(callbackUrl);
  } catch {
    throw new Error("GMAIL_CALLBACK_URL must be a valid URL");
  }

  const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(
    parsedUrl.hostname
  );

  if (parsedUrl.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error(
      "GMAIL_CALLBACK_URL must use HTTPS outside local development"
    );
  }

  return callbackUrl;
};

export const getGmailOAuthConfiguration = () => ({
  clientId: requireEnvironmentVariable("GOOGLE_CLIENT_ID"),
  clientSecret: requireEnvironmentVariable("GOOGLE_CLIENT_SECRET"),
  callbackUrl: validateCallbackUrl(
    requireEnvironmentVariable("GMAIL_CALLBACK_URL")
  ),
});

export const createGmailOAuthClient = () => {


  try {
    const { clientId, clientSecret, callbackUrl } =
      getGmailOAuthConfiguration();

    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  } catch (error) {
  
    throw error;
  }
};

export const createGmailApiClient = (auth) =>
  google.gmail({ version: "v1", auth });
