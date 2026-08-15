import db from "../config/db.js";
import {
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
} from "../utils/gmailTokenEncryption.js";

const PUBLIC_COLUMNS = `
  id,
  user_id,
  google_account_id,
  gmail_email,
  access_token_expires_at,
  granted_scopes,
  connection_status,
  connected_at,
  updated_at,
  revoked_at
`;

const serializeScopes = (grantedScopes) => {
  if (!Array.isArray(grantedScopes)) {
    throw new Error("Gmail granted scopes must be an array");
  }

  return JSON.stringify([...new Set(grantedScopes)].sort());
};

const deserializeScopes = (connection) => {
  if (!connection) return connection;

  return {
    ...connection,
    granted_scopes: JSON.parse(connection.granted_scopes),
  };
};

export const findGmailConnectionByUserId = async (userId) => {
  const [rows] = await db.query(
    `SELECT ${PUBLIC_COLUMNS}
     FROM gmail_connections
     WHERE user_id = ?`,
    [userId]
  );

  return deserializeScopes(rows[0]);
};

export const saveGmailConnection = async ({
  userId,
  googleAccountId,
  gmailEmail,
  refreshToken,
  accessTokenExpiresAt = null,
  grantedScopes = [],
}) => {
  if (!googleAccountId || typeof googleAccountId !== "string") {
    throw new Error("A Google account ID is required");
  }

  if (!gmailEmail || typeof gmailEmail !== "string") {
    throw new Error("A Gmail email address is required");
  }

  const normalizedGoogleAccountId = googleAccountId.trim();
  const normalizedEmail = gmailEmail.trim().toLowerCase();

  if (!normalizedGoogleAccountId || !normalizedEmail) {
    throw new Error("Google account ID and Gmail email cannot be empty");
  }

  
  let encryptedRefreshToken;
  try {
    encryptedRefreshToken = encryptGmailRefreshToken(refreshToken);
  } catch (error) {
    console.error("Gmail connection refresh-token encryption failed");
    console.error("Gmail callback error.message:", error.message);
    console.error("Gmail callback error.code:", error.code);
    console.error("Gmail callback error.stack:", error.stack);
    throw error;
  }
  const serializedScopes = serializeScopes(grantedScopes);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `SELECT id
       FROM gmail_connections
       WHERE user_id = ?
       FOR UPDATE`,
      [userId]
    );

    let result;

    if (existingRows[0]) {
      [result] = await connection.query(
        `UPDATE gmail_connections
         SET google_account_id = ?,
             gmail_email = ?,
             encrypted_refresh_token = ?,
             access_token_expires_at = ?,
             granted_scopes = ?,
             connection_status = 'connected',
             connected_at = CURRENT_TIMESTAMP,
             revoked_at = NULL
         WHERE user_id = ?`,
        [
          normalizedGoogleAccountId,
          normalizedEmail,
          encryptedRefreshToken,
          accessTokenExpiresAt,
          serializedScopes,
          userId,
        ]
      );
    } else {
      [result] = await connection.query(
        `INSERT INTO gmail_connections (
           user_id,
           google_account_id,
           gmail_email,
           encrypted_refresh_token,
           access_token_expires_at,
           granted_scopes
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          normalizedGoogleAccountId,
          normalizedEmail,
          encryptedRefreshToken,
          accessTokenExpiresAt,
          serializedScopes,
        ]
      );
    }

    await connection.commit();
    return result;
  } catch (error) {
    console.error("Gmail connection database persistence failed");
    console.error("Gmail callback error.message:", error.message);
    console.error("Gmail callback error.code:", error.code);
    console.error("Gmail callback error.stack:", error.stack);
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Internal credential access only. Never serialize this result in an API response.
export const getDecryptedGmailCredentialsByUserId = async (userId) => {
  const [rows] = await db.query(
    `SELECT
       id,
       google_account_id,
       gmail_email,
       encrypted_refresh_token,
       access_token_expires_at,
       granted_scopes,
       connection_status
     FROM gmail_connections
     WHERE user_id = ?`,
    [userId]
  );
  const connection = rows[0];

  if (!connection) return undefined;

  return {
    gmailConnectionId: connection.id,
    googleAccountId: connection.google_account_id,
    gmailEmail: connection.gmail_email,
    refreshToken: connection.encrypted_refresh_token
      ? decryptGmailRefreshToken(connection.encrypted_refresh_token)
      : null,
    accessTokenExpiresAt: connection.access_token_expires_at,
    grantedScopes: JSON.parse(connection.granted_scopes),
    connectionStatus: connection.connection_status,
  };
};

export const revokeGmailConnection = async (userId) => {
  const [result] = await db.query(
    `UPDATE gmail_connections
     SET encrypted_refresh_token = NULL,
         access_token_expires_at = NULL,
         connection_status = 'revoked',
         revoked_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [userId]
  );

  return result;
};

export const listConnectedGmailUsers = async () => {
  const [rows] = await db.query(
    `SELECT user_id
     FROM gmail_connections
     WHERE connection_status = 'connected'
       AND encrypted_refresh_token IS NOT NULL
     ORDER BY user_id`
  );
  return rows.map((row) => ({ userId: row.user_id }));
};

export const markGmailConnectionError = async (userId) => {
  const [result] = await db.query(
    `UPDATE gmail_connections
     SET connection_status = 'error'
     WHERE user_id = ?
       AND connection_status = 'connected'`,
    [userId]
  );
  return result;
};
