CREATE TABLE mail_user_state (
  mail_id INT NOT NULL,
  user_id INT NOT NULL,
  mailbox_role ENUM('sender', 'receiver') NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  is_important BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_spam BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (mail_id, user_id),
  KEY idx_mail_user_state_user_role (user_id, mailbox_role),
  KEY idx_mail_user_state_user_read (user_id, is_read),
  KEY idx_mail_user_state_user_starred (user_id, is_starred),
  KEY idx_mail_user_state_user_important (user_id, is_important),
  KEY idx_mail_user_state_user_archived (user_id, is_archived),
  KEY idx_mail_user_state_user_spam (user_id, is_spam),
  CONSTRAINT fk_mail_user_state_mail
    FOREIGN KEY (mail_id) REFERENCES mails (id) ON DELETE CASCADE,
  CONSTRAINT fk_mail_user_state_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO mail_user_state (
  mail_id,
  user_id,
  mailbox_role,
  is_read,
  is_starred,
  is_important,
  is_archived,
  is_spam
)
SELECT
  id,
  sender_user_id,
  'sender',
  TRUE,
  FALSE,
  FALSE,
  FALSE,
  FALSE
FROM mails;

INSERT INTO mail_user_state (
  mail_id,
  user_id,
  mailbox_role,
  is_read,
  is_starred,
  is_important,
  is_archived,
  is_spam
)
SELECT
  id,
  receiver_user_id,
  'receiver',
  is_read,
  is_starred,
  is_important,
  is_archived,
  is_spam
FROM mails;
