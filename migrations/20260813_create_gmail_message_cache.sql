CREATE TABLE gmail_sync_state (
  id INT NOT NULL AUTO_INCREMENT,
  gmail_connection_id INT NOT NULL,
  history_id VARCHAR(255) NULL,
  initial_sync_completed_at DATETIME NULL,
  last_sync_started_at DATETIME NULL,
  last_sync_completed_at DATETIME NULL,
  sync_status ENUM('idle', 'syncing', 'completed', 'failed')
    NOT NULL DEFAULT 'idle',
  error_category VARCHAR(100) NULL,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gmail_sync_state_connection (gmail_connection_id),
  CONSTRAINT fk_gmail_sync_state_connection
    FOREIGN KEY (gmail_connection_id)
    REFERENCES gmail_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE gmail_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  gmail_connection_id INT NOT NULL,
  gmail_message_id VARCHAR(255) NOT NULL,
  gmail_thread_id VARCHAR(255) NULL,
  rfc_message_id VARCHAR(998) NULL,
  history_id VARCHAR(255) NULL,
  internal_date DATETIME NOT NULL,
  from_email VARCHAR(320) NULL,
  from_name VARCHAR(255) NULL,
  subject VARCHAR(998) NOT NULL DEFAULT '',
  snippet TEXT NULL,
  body_text LONGTEXT NULL,
  body_html LONGTEXT NULL,
  label_ids TEXT NOT NULL,
  mime_type VARCHAR(255) NULL,
  size_estimate BIGINT UNSIGNED NULL,
  has_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  remote_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gmail_messages_connection_message
    (gmail_connection_id, gmail_message_id),
  KEY idx_gmail_messages_connection_date
    (gmail_connection_id, internal_date, id),
  KEY idx_gmail_messages_connection_thread
    (gmail_connection_id, gmail_thread_id),
  CONSTRAINT fk_gmail_messages_connection
    FOREIGN KEY (gmail_connection_id)
    REFERENCES gmail_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE gmail_message_recipients (
  id BIGINT NOT NULL AUTO_INCREMENT,
  gmail_message_record_id BIGINT NOT NULL,
  recipient_type ENUM('to', 'cc', 'bcc') NOT NULL,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(255) NULL,
  matched_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gmail_recipients_message_type
    (gmail_message_record_id, recipient_type),
  KEY idx_gmail_recipients_matched_user (matched_user_id),
  CONSTRAINT fk_gmail_recipients_message
    FOREIGN KEY (gmail_message_record_id)
    REFERENCES gmail_messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_gmail_recipients_user
    FOREIGN KEY (matched_user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE gmail_attachments (
  id BIGINT NOT NULL AUTO_INCREMENT,
  gmail_message_record_id BIGINT NOT NULL,
  gmail_attachment_id VARCHAR(255) NULL,
  mime_part_id VARCHAR(255) NOT NULL,
  filename VARCHAR(998) NOT NULL,
  mime_type VARCHAR(255) NULL,
  size BIGINT UNSIGNED NULL,
  cache_path VARCHAR(500) NULL,
  cache_status ENUM('remote', 'cached', 'failed')
    NOT NULL DEFAULT 'remote',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gmail_attachments_message_part
    (gmail_message_record_id, mime_part_id),
  CONSTRAINT fk_gmail_attachments_message
    FOREIGN KEY (gmail_message_record_id)
    REFERENCES gmail_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
