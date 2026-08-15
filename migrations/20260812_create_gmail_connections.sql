CREATE TABLE gmail_connections (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  google_account_id VARCHAR(255) NOT NULL,
  gmail_email VARCHAR(255) NOT NULL,
  encrypted_refresh_token TEXT NULL,
  access_token_expires_at DATETIME NULL,
  granted_scopes TEXT NOT NULL,
  connection_status ENUM('connected', 'revoked', 'error')
    NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gmail_connections_user (user_id),
  UNIQUE KEY uq_gmail_connections_google_account (google_account_id),
  KEY idx_gmail_connections_status (connection_status),
  CONSTRAINT fk_gmail_connections_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
