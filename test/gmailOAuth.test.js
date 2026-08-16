import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import jwt from "jsonwebtoken";
import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_OAUTH_SCOPES,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
} from "../config/gmailOAuth.js";
import { serializeGmailConnectionStatus } from "../controllers/gmailController.js";
import { getGoogleLoginRedirect } from "../controllers/userControllers.js";
import checkToken from "../middleware/CheckToken.js";
import {
  completeGmailOAuthConnection,
  createGmailAuthorizationRequest,
  disconnectGmailConnection,
  GmailOAuthError,
} from "../services/gmailOAuthService.js";
import {
  createGmailOAuthState,
  validateGmailOAuthState,
} from "../utils/gmailOAuthState.js";
import {
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
} from "../utils/gmailTokenEncryption.js";

const originalEnvironment = {
  gmailStateSecret: process.env.GMAIL_OAUTH_STATE_SECRET,
  gmailEncryptionKey: process.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  jwtSecret: process.env.JWT_SECRET,
};

before(() => {
  process.env.GMAIL_OAUTH_STATE_SECRET = "s".repeat(32);
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64"
  );
  process.env.JWT_SECRET = "test-jwt-secret";
});

after(() => {
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  restore("GMAIL_OAUTH_STATE_SECRET", originalEnvironment.gmailStateSecret);
  restore(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    originalEnvironment.gmailEncryptionKey
  );
  restore("JWT_SECRET", originalEnvironment.jwtSecret);
});

const createOAuthClient = ({
  googleAccountId = "google-account-1",
  refreshToken = "refresh-token",
  scopes = GMAIL_OAUTH_SCOPES,
} = {}) => ({
  getToken: async () => ({
    tokens: {
      access_token: "access-token",
      refresh_token: refreshToken,
      id_token: "id-token",
      expiry_date: 2_000_000_000_000,
    },
  }),
  setCredentials() {},
  verifyIdToken: async () => ({
    getPayload: () => ({ sub: googleAccountId }),
  }),
  getTokenInfo: async () => ({ scopes }),
});

describe("Gmail OAuth authorization", () => {
  test("continues a new Google user into Gmail consent when no connection exists", () => {
    assert.equal(
      getGoogleLoginRedirect({
        gmailConnection: undefined,
        frontendUrl: "http://localhost:5173",
      }),
      "/gmail/connect"
    );
  });

  test("finishes Google login normally when Gmail is already connected", () => {
    assert.equal(
      getGoogleLoginRedirect({
        gmailConnection: { connection_status: "connected" },
        frontendUrl: "http://localhost:5173",
      }),
      "http://localhost:5173/"
    );
  });

  test("requests read, modify, and send Gmail consent", () => {
    let options;
    const { authorizationUrl, stateCookie } = createGmailAuthorizationRequest({
      userId: 42,
      oauthClient: {
        generateAuthUrl(value) {
          options = value;
          return "https://accounts.google.com/o/oauth2/v2/auth";
        },
      },
    });

    assert.equal(
      authorizationUrl,
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    assert.equal(options.access_type, "offline");
    assert.equal(options.prompt, "consent");
    assert.deepEqual(options.scope, GMAIL_OAUTH_SCOPES);
    assert.ok(options.state);
    assert.ok(stateCookie);
  });

  test("hints the Gmail consent flow with the authenticated user's email", () => {
    let options;

    createGmailAuthorizationRequest({
      userId: 91,
      loginHint: "SinhaSwitu9670@Gmail.com",
      oauthClient: {
        generateAuthUrl(value) {
          options = value;
          return "https://accounts.google.com/o/oauth2/v2/auth";
        },
      },
    });

    assert.equal(options.login_hint, "sinhaswitu9670@gmail.com");
  });

  test("validates state against both its cookie and authenticated user", () => {
    const { state, stateCookie } = createGmailOAuthState(42);

    assert.equal(
      validateGmailOAuthState({ state, stateCookie, userId: 42 }),
      true
    );
    assert.throws(
      () => validateGmailOAuthState({ state, stateCookie, userId: 43 }),
      /Invalid Gmail OAuth state/
    );
    assert.throws(
      () =>
        validateGmailOAuthState({
          state: `${state}tampered`,
          stateCookie,
          userId: 42,
        }),
      /Invalid Gmail OAuth state/
    );
  });
});

describe("Gmail OAuth completion", () => {
  test("verifies Gmail and persists connection data", async () => {
    let savedConnection;

    const result = await completeGmailOAuthConnection({
      code: "authorization-code",
      user: { id: 42, google_id: "google-account-1" },
      oauthClient: createOAuthClient(),
      createGmailClient: () => ({
        users: {
          getProfile: async () => ({
            data: { emailAddress: "User@Gmail.com" },
          }),
        },
      }),
      persistConnection: async (connection) => {
        savedConnection = connection;
      },
      clientId: "client-id",
    });

    assert.deepEqual(result, {
      connected: true,
      email: "user@gmail.com",
    });
    assert.equal(savedConnection.userId, 42);
    assert.equal(savedConnection.googleAccountId, "google-account-1");
    assert.equal(savedConnection.gmailEmail, "user@gmail.com");
    assert.equal(savedConnection.refreshToken, "refresh-token");
    assert.deepEqual(savedConnection.grantedScopes, [
      "openid",
      GMAIL_READONLY_SCOPE,
      GMAIL_MODIFY_SCOPE,
      GMAIL_SEND_SCOPE,
    ]);
  });

  test("rejects a mismatched Google account before Gmail access or storage", async () => {
    let gmailCalled = false;
    let storageCalled = false;

    await assert.rejects(
      completeGmailOAuthConnection({
        code: "authorization-code",
        user: { id: 42, google_id: "expected-account" },
        oauthClient: createOAuthClient({ googleAccountId: "other-account" }),
        createGmailClient: () => {
          gmailCalled = true;
          return {};
        },
        persistConnection: async () => {
          storageCalled = true;
        },
        clientId: "client-id",
      }),
      (error) =>
        error instanceof GmailOAuthError &&
        error.code === "account_mismatch"
    );

    assert.equal(gmailCalled, false);
    assert.equal(storageCalled, false);
  });

  test("rejects a missing refresh token without storing a connection", async () => {
    let storageCalled = false;

    await assert.rejects(
      completeGmailOAuthConnection({
        code: "authorization-code",
        user: { id: 42, google_id: "google-account-1" },
        oauthClient: createOAuthClient({ refreshToken: null }),
        createGmailClient: () => ({}),
        persistConnection: async () => {
          storageCalled = true;
        },
        clientId: "client-id",
      }),
      (error) =>
        error instanceof GmailOAuthError &&
        error.code === "missing_refresh_token"
    );

    assert.equal(storageCalled, false);
  });

  test("requires every requested Gmail action scope", async () => {
    await assert.rejects(
      completeGmailOAuthConnection({
        code: "authorization-code",
        user: { id: 42, google_id: "google-account-1" },
        oauthClient: createOAuthClient({ scopes: ["openid"] }),
        createGmailClient: () => ({}),
        persistConnection: async () => {},
        clientId: "client-id",
      }),
      (error) =>
        error instanceof GmailOAuthError &&
        error.code === "gmail_scope_missing"
    );
  });

  test("disconnect revokes Google access and clears local credentials", async () => {
    let revokedToken;
    let locallyRevokedUserId;

    const result = await disconnectGmailConnection({
      userId: 42,
      getCredentials: async () => ({
        refreshToken: "refresh-token",
        connectionStatus: "connected",
      }),
      oauthClient: {
        revokeToken: async (token) => {
          revokedToken = token;
        },
      },
      markRevoked: async (userId) => {
        locallyRevokedUserId = userId;
      },
    });

    assert.equal(revokedToken, "refresh-token");
    assert.equal(locallyRevokedUserId, 42);
    assert.deepEqual(result, {
      disconnected: true,
      googleRevoked: true,
    });
  });

  test("disconnect clears local credentials if Google revocation fails", async () => {
    let locallyRevoked = false;

    const result = await disconnectGmailConnection({
      userId: 42,
      getCredentials: async () => ({
        refreshToken: "refresh-token",
        connectionStatus: "connected",
      }),
      oauthClient: {
        revokeToken: async () => {
          throw new Error("Remote revocation unavailable");
        },
      },
      markRevoked: async () => {
        locallyRevoked = true;
      },
    });

    assert.equal(locallyRevoked, true);
    assert.deepEqual(result, {
      disconnected: true,
      googleRevoked: false,
    });
  });
});

describe("Gmail token and response safety", () => {
  test("encrypts refresh tokens with authenticated encryption", () => {
    const encrypted = encryptGmailRefreshToken("refresh-token");

    assert.equal(encrypted.includes("refresh-token"), false);
    assert.equal(decryptGmailRefreshToken(encrypted), "refresh-token");
  });

  test("status metadata never includes credentials", () => {
    const response = serializeGmailConnectionStatus({
      gmail_email: "user@gmail.com",
      connection_status: "connected",
      granted_scopes: JSON.stringify(GMAIL_OAUTH_SCOPES),
      encrypted_refresh_token: "must-not-escape",
      access_token: "must-not-escape",
    });

    assert.deepEqual(response, {
      connected: true,
      email: "user@gmail.com",
      reconnectRequired: false,
      missingScopes: [],
    });
  });

  test("status requires reconnect for legacy read-only connections", () => {
    const response = serializeGmailConnectionStatus({
      gmail_email: "user@gmail.com",
      connection_status: "connected",
      granted_scopes: JSON.stringify(["openid", GMAIL_READONLY_SCOPE]),
    });

    assert.equal(response.connected, true);
    assert.equal(response.reconnectRequired, true);
    assert.deepEqual(response.missingScopes, [
      GMAIL_MODIFY_SCOPE,
      GMAIL_SEND_SCOPE,
    ]);
  });

  test("existing authentication middleware rejects unauthenticated access", () => {
    let statusCode;
    let responseBody;
    let nextCalled = false;
    const req = { cookies: {}, headers: {} };
    const res = {
      status(value) {
        statusCode = value;
        return this;
      },
      json(value) {
        responseBody = value;
        return this;
      },
    };

    checkToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.deepEqual(responseBody, { message: "Token not found" });
  });

  test("existing authentication middleware accepts an authenticated user", () => {
    const token = jwt.sign({ id: 42, email: "user@example.com" }, "test-jwt-secret");
    let nextCalled = false;
    const req = {
      cookies: { token },
      headers: {},
    };

    checkToken(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 42);
    assert.equal(req.user.email, "user@example.com");
  });
});
