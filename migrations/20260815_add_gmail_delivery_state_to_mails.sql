ALTER TABLE mails
  ADD COLUMN gmail_delivery_status
    ENUM('internal_only', 'pending', 'sent', 'failed')
    NOT NULL DEFAULT 'internal_only'
    AFTER status,
  ADD COLUMN gmail_message_id VARCHAR(255) NULL
    AFTER gmail_delivery_status,
  ADD COLUMN gmail_thread_id VARCHAR(255) NULL
    AFTER gmail_message_id,
  ADD COLUMN gmail_delivery_error_code VARCHAR(100) NULL
    AFTER gmail_thread_id,
  ADD COLUMN gmail_delivery_error_message VARCHAR(500) NULL
    AFTER gmail_delivery_error_code,
  ADD COLUMN gmail_delivery_updated_at DATETIME NULL
    AFTER gmail_delivery_error_message,
  ADD KEY idx_mails_gmail_delivery_status (gmail_delivery_status);
