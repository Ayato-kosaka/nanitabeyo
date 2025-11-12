-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: user_notification_cursors
-- 役割: 既読カーソル（ユーザー単位の last_read_at）
-- =========================

CREATE TABLE IF NOT EXISTS user_notification_cursors (
  user_id      uuid PRIMARY KEY,
  last_read_at timestamptz NOT NULL
);

-- コメント
COMMENT ON TABLE user_notification_cursors IS '通知の既読カーソル（ユーザー単位）';
COMMENT ON COLUMN user_notification_cursors.last_read_at IS '最後に既読化したサーバー時刻';

-- RLS（有効化のみ）
ALTER TABLE user_notification_cursors ENABLE ROW LEVEL SECURITY;
