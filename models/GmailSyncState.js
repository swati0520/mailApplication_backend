import db from "../config/db.js";

const LEASE_SECONDS = 5 * 60;

export const acquireGmailSyncLease = async (gmailConnectionId) => {
  await db.query(
    `INSERT INTO gmail_sync_state
       (gmail_connection_id, sync_status)
     VALUES (?, 'idle')
     ON DUPLICATE KEY UPDATE gmail_connection_id = VALUES(gmail_connection_id)`,
    [gmailConnectionId]
  );
  const [result] = await db.query(
    `UPDATE gmail_sync_state
     SET sync_status = 'syncing',
         error_category = NULL,
         last_sync_started_at = NOW(),
         locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE gmail_connection_id = ?
       AND (locked_until IS NULL OR locked_until < NOW())`,
    [LEASE_SECONDS, gmailConnectionId]
  );
  return result.affectedRows === 1;
};

export const completeGmailSync = async ({
  gmailConnectionId,
  historyId,
}) => {
  const [result] = await db.query(
    `UPDATE gmail_sync_state
     SET history_id = ?,
         initial_sync_completed_at = COALESCE(initial_sync_completed_at, NOW()),
         last_sync_completed_at = NOW(),
         sync_status = 'completed',
         error_category = NULL,
         locked_until = NULL
     WHERE gmail_connection_id = ?`,
    [historyId, gmailConnectionId]
  );
  return result;
};

export const failGmailSync = async (gmailConnectionId, errorCategory) => {
  const [result] = await db.query(
    `UPDATE gmail_sync_state
     SET sync_status = 'failed',
         error_category = ?,
         locked_until = NULL
     WHERE gmail_connection_id = ?`,
    [errorCategory, gmailConnectionId]
  );
  return result;
};

export const releaseGmailSyncLease = async (gmailConnectionId) => {
  const [result] = await db.query(
    `UPDATE gmail_sync_state
     SET locked_until = NULL
     WHERE gmail_connection_id = ?`,
    [gmailConnectionId]
  );
  return result;
};

export const findGmailSyncStateByConnectionId = async (
  gmailConnectionId
) => {
  const [rows] = await db.query(
    `SELECT
       history_id,
       initial_sync_completed_at,
       last_sync_started_at,
       last_sync_completed_at,
       sync_status,
       error_category,
       locked_until
     FROM gmail_sync_state
     WHERE gmail_connection_id = ?`,
    [gmailConnectionId]
  );
  return rows[0];
};

export const findGmailSyncStatusForUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT
       state.history_id,
       state.initial_sync_completed_at,
       state.last_sync_started_at,
       state.last_sync_completed_at,
       state.sync_status,
       state.error_category
     FROM gmail_connections connections
     LEFT JOIN gmail_sync_state state
       ON state.gmail_connection_id = connections.id
     WHERE connections.user_id = ?
       AND connections.connection_status = 'connected'`,
    [userId]
  );
  return rows[0];
};
