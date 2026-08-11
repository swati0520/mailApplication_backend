CREATE TABLE mail_recipients (
  mail_id INT NOT NULL,
  user_id INT NOT NULL,
  recipient_type ENUM('to', 'cc', 'bcc') NOT NULL,
  email_snapshot VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mail_id, user_id),
  KEY idx_mail_recipients_user_mail (user_id, mail_id),
  KEY idx_mail_recipients_mail_type (mail_id, recipient_type),
  CONSTRAINT fk_mail_recipients_mail
    FOREIGN KEY (mail_id) REFERENCES mails (id) ON DELETE CASCADE,
  CONSTRAINT fk_mail_recipients_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE mail_user_state
  ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN is_permanently_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN permanently_deleted_at DATETIME NULL,
  ADD KEY idx_mail_user_state_user_deleted
    (user_id, is_deleted, is_permanently_deleted);

START TRANSACTION;

INSERT INTO mail_recipients (
  mail_id,
  user_id,
  recipient_type,
  email_snapshot
)
SELECT
  id,
  receiver_user_id,
  'to',
  LOWER(TRIM(to_email))
FROM mails
WHERE receiver_user_id IS NOT NULL;

-- The inspected database contained no legacy CC or BCC addresses.
-- No CC/BCC recipient or state rows are required for this migration.

UPDATE mail_user_state AS state
INNER JOIN mails ON mails.id = state.mail_id
SET
  state.is_deleted = CASE
    WHEN state.mailbox_role = 'sender'
      THEN COALESCE(mails.sender_is_deleted, FALSE)
    WHEN state.mailbox_role = 'receiver'
      THEN COALESCE(mails.receiver_is_deleted, FALSE)
    ELSE FALSE
  END,
  state.deleted_at = NULL,
  state.is_permanently_deleted = FALSE,
  state.permanently_deleted_at = NULL;

COMMIT;
