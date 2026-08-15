import {
  createGmailApiClient,
  createGmailOAuthClient,
  GMAIL_READONLY_SCOPE,
} from "../config/gmailOAuth.js";
import { getDecryptedGmailCredentialsByUserId } from "../models/GmailConnection.js";

export class GmailConnectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GmailConnectionError";
    this.code = code;
  }
}

export const getAuthenticatedGmailClient = async ({
  userId,
  getCredentials = getDecryptedGmailCredentialsByUserId,
  createOAuthClient = createGmailOAuthClient,
  createGmailClient = createGmailApiClient,
  requiredScopes = [GMAIL_READONLY_SCOPE],
}) => {
  const credentials = await getCredentials(userId);

  if (
    !credentials ||
    credentials.connectionStatus !== "connected" ||
    !credentials.refreshToken
  ) {
    throw new GmailConnectionError(
      "gmail_not_connected",
      "A connected Gmail account is required"
    );
  }

  const missingScopes = requiredScopes.filter(
    (scope) => !credentials.grantedScopes.includes(scope)
  );
  if (missingScopes.length) {
    throw new GmailConnectionError(
      "gmail_scope_missing",
      "Reconnect Gmail to grant the permissions required for this action"
    );
  }

  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({ refresh_token: credentials.refreshToken });

  const client = {
    gmail: createGmailClient(oauthClient),
    gmailConnectionId: credentials.gmailConnectionId,
  };
  if (credentials.gmailEmail) client.gmailEmail = credentials.gmailEmail;
  return client;
};
