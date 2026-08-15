ALTER TABLE notifications
  ADD COLUMN source_key VARCHAR(300) NULL AFTER mail_id,
  ADD UNIQUE KEY uq_notifications_user_source (user_id, source_key);
