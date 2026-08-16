import expressAsyncHandler from "express-async-handler";
import { createGmailOAuthClient } from "../config/gmailOAuth.js";
import { GMAIL_REQUIRED_SCOPES } from "../config/gmailOAuth.js";
import {
  findGmailConnectionByUserId,
} from "../models/GmailConnection.js";
import { findUserById } from "../models/User.js";
import {
  completeGmailOAuthConnection,
  createGmailAuthorizationRequest,
  disconnectGmailConnection,
  GmailOAuthError,
} from "../services/gmailOAuthService.js";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  gmailOAuthStateClearOptions,
  gmailOAuthStateCookieOptions,
  validateGmailOAuthState,
} from "../utils/gmailOAuthState.js";

const redirectToFrontend = (res, result, reason) => {
  const frontendUrl = process.env.FRONTEND_URL?.trim();

  if (!frontendUrl) {
    throw new Error("FRONTEND_URL is not configured");
  }

  const redirectUrl = new URL(frontendUrl);
  redirectUrl.searchParams.set("gmail", result);

  if (reason) {
    redirectUrl.searchParams.set("reason", reason);
  }

  return res.redirect(redirectUrl.toString());
};

export const connectGmail = expressAsyncHandler(async (req, res) => {
  try {
   
    const user = await findUserById(req.user.id);
    [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GMAIL_CALLBACK_URL",
      "GMAIL_OAUTH_STATE_SECRET",
    ].forEach((name) => {
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.google_id) {
      return res.status(409).json({
        message: "Link a Google account before connecting Gmail",
      });
    }

    const { authorizationUrl, stateCookie } =
      createGmailAuthorizationRequest({
        userId: user.id,
        loginHint: user.email,
      });

    res.cookie(
      GMAIL_OAUTH_STATE_COOKIE,
      stateCookie,
      gmailOAuthStateCookieOptions
    );

    return res.redirect(authorizationUrl);
  } catch (error) {
    throw error;
  }
});

export const gmailOAuthCallback = expressAsyncHandler(async (req, res) => {
  const stateCookie = req.cookies?.[GMAIL_OAUTH_STATE_COOKIE];
  res.clearCookie(GMAIL_OAUTH_STATE_COOKIE, gmailOAuthStateClearOptions);


  try {
    validateGmailOAuthState({
      state: req.query.state,
      stateCookie,
      userId: req.user.id,
    });
     } catch (error) {
   
    return res.status(400).json({ message: "Invalid Gmail OAuth state" });
  }

  if (req.query.error) {
   
    return redirectToFrontend(res, "error", "authorization_denied");
  }


  let user;
  try {
    user = await findUserById(req.user.id);
  
  } catch (error) {
  
    throw error;
  }

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
   
    await completeGmailOAuthConnection({
      code: req.query.code,
      user,
    });
    
    return redirectToFrontend(res, "connected");
  } catch (error) {
   
    const reason =
      error instanceof GmailOAuthError
        ? error.code
        : "connection_failed";

    return redirectToFrontend(res, "error", reason);
  }
});

export const serializeGmailConnectionStatus = (connection) => {
  const connected = connection?.connection_status === "connected";
  let grantedScopes = [];
  if (connected) {
    try {
      grantedScopes = Array.isArray(connection.granted_scopes)
        ? connection.granted_scopes
        : JSON.parse(connection.granted_scopes || "[]");
    } catch {
      grantedScopes = [];
    }
  }
  const missingScopes = connected
    ? GMAIL_REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope))
    : [];

  return {
    connected,
    email: connected ? connection.gmail_email : null,
    reconnectRequired: connected && missingScopes.length > 0,
    missingScopes,
  };
};

export const getGmailConnectionStatus = expressAsyncHandler(
  async (req, res) => {

  

    try {
      
      const connection = await findGmailConnectionByUserId(req.user.id);
 

      const response = serializeGmailConnectionStatus(connection);
    

      return res.status(200).json(response);
    } catch (error) {
    
      throw error;
    }
  }
);

export const disconnectGmail = expressAsyncHandler(async (req, res) => {
  const result = await disconnectGmailConnection({
    userId: req.user.id,
    oauthClient: createGmailOAuthClient(),
  });

  return res.status(200).json({
    message: "Gmail account disconnected",
    ...result,
  });
});
