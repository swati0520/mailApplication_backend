import {
  createGmailApiClient,
  createGmailOAuthClient,
  getGmailOAuthConfiguration,
  GMAIL_OAUTH_SCOPES,
  GMAIL_REQUIRED_SCOPES,
} from "../config/gmailOAuth.js";
import {
  getDecryptedGmailCredentialsByUserId,
  revokeGmailConnection,
  saveGmailConnection,
} from "../models/GmailConnection.js";
import { createGmailOAuthState } from "../utils/gmailOAuthState.js";

export class GmailOAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GmailOAuthError";
    this.code = code;
  }
}

const requireToken = (value, code, message) => {
  if (!value || typeof value !== "string") {
    throw new GmailOAuthError(code, message);
  }

  return value;
};

export const createGmailAuthorizationRequest = ({
  userId,
  oauthClient = createGmailOAuthClient(),
}) => {
  let state;
  let stateCookie;

  try {
    ({ state, stateCookie } = createGmailOAuthState(userId));
  } catch (error) {

    throw error;
  }

  let authorizationUrl;
  try {
    authorizationUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GMAIL_OAUTH_SCOPES,
      state,
    });
  } catch (error) {
   
    throw error;
  }

  return { authorizationUrl, stateCookie };
};

export const completeGmailOAuthConnection = async ({
  code,
  user,
  oauthClient = createGmailOAuthClient(),
  createGmailClient = createGmailApiClient,
  persistConnection = saveGmailConnection,
  clientId = getGmailOAuthConfiguration().clientId,
}) => {
  if (!user?.id || !user.google_id) {
    throw new GmailOAuthError(
      "google_login_required",
      "A linked Google account is required"
    );
  }

  const authorizationCode = requireToken(
    code,
    "missing_code",
    "Google did not return an authorization code"
  );
  let tokens;
  try {
    ({ tokens } = await oauthClient.getToken(authorizationCode));
  } catch (error) {
  
    throw error;
  }
  const accessToken = requireToken(
    tokens.access_token,
    "missing_access_token",
    "Google did not return an access token"
  );
  const refreshToken = requireToken(
    tokens.refresh_token,
    "missing_refresh_token",
    "Google did not return a refresh token; reconnect and grant consent"
  );
  const idToken = requireToken(
    tokens.id_token,
    "missing_identity",
    "Google account identity could not be verified"
  );

  oauthClient.setCredentials(tokens);

  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
  } catch (error) {
    
    throw error;
  }
  const googleAccountId = ticket.getPayload()?.sub;

  if (!googleAccountId) {
    throw new GmailOAuthError(
      "missing_identity",
      "Google account identity could not be verified"
    );
  }

  if (String(googleAccountId) !== String(user.google_id)) {
  
    throw new GmailOAuthError(
      "account_mismatch",
      "Connect the same Google account used by this application account"
    );
  }
  const tokenInfo = await oauthClient.getTokenInfo(accessToken);
  const grantedScopes = Array.isArray(tokenInfo.scopes)
    ? tokenInfo.scopes
    : [];
  const missingScopes = GMAIL_REQUIRED_SCOPES.filter(
    (scope) => !grantedScopes.includes(scope)
  );
  if (missingScopes.length) {
    throw new GmailOAuthError(
      "gmail_scope_missing",
      "Gmail read, modify, and send permissions must all be granted"
    );
  }

  const gmail = createGmailClient(oauthClient);
  let gmailProfile;
  try {
    ({ data: gmailProfile } = await gmail.users.getProfile({
      userId: "me",
    }));
  } catch (error) {
  
    throw error;
  }
  const gmailEmail = gmailProfile?.emailAddress?.trim().toLowerCase();

  if (!gmailEmail) {
    throw new GmailOAuthError(
      "gmail_verification_failed",
      "Gmail account access could not be verified"
    );
  }

  try {
    await persistConnection({
      userId: user.id,
      googleAccountId,
      gmailEmail,
      refreshToken,
      accessTokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : null,
      grantedScopes,
    });
  } catch (error) {
    
    throw error;
  }

  return {
    connected: true,
    email: gmailEmail,
  };
};

export const disconnectGmailConnection = async ({
  userId,
  getCredentials = getDecryptedGmailCredentialsByUserId,
  markRevoked = revokeGmailConnection,
  oauthClient = createGmailOAuthClient(),
}) => {
  const credentials = await getCredentials(userId);

  if (!credentials || credentials.connectionStatus === "revoked") {
    return { disconnected: true, googleRevoked: true };
  }

  let googleRevoked = false;

  if (credentials.refreshToken) {
    try {
      await oauthClient.revokeToken(credentials.refreshToken);
      googleRevoked = true;
    } catch {
      // Local credentials must still be removed if remote revocation fails.
    }
  }

  await markRevoked(userId);

  return { disconnected: true, googleRevoked };
};
