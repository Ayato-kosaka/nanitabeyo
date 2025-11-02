-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: notification_recipients
-- 役割: 通知の受取人（N:N リンク、既読カーソルの基準 created_at を保持）
-- =========================

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id  uuid REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_id     uuid NOT NULL,
  thread_updated_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, recipient_id)
);

-- 一覧・カーソル用（キーセット）
CREATE INDEX IF NOT EXISTS idx_nr_recipient_created
  ON notification_recipients (recipient_id, created_at DESC, notification_id DESC);

-- コメント
COMMENT ON TABLE notification_recipients IS '通知の配信対象ユーザー（受取人）';
COMMENT ON COLUMN notification_recipients.created_at IS '受信時刻（一覧のカーソル基準）';

-- RLS（有効化のみ）
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;
