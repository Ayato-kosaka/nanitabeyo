-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: user_device_tokens
-- 役割: Expo Push Token の登録（ユーザー×トークンで冪等）
-- =========================

CREATE TABLE IF NOT EXISTS user_device_tokens (
  user_id          uuid NOT NULL,
  expo_push_token  text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, expo_push_token)
);

-- 任意の補助列を運用で追加する場合（例）
-- ALTER TABLE user_device_tokens
--   ADD COLUMN IF NOT EXISTS platform text,
--   ADD COLUMN IF NOT EXISTS device_id text,
--   ADD COLUMN IF NOT EXISTS app_version text,
--   ADD COLUMN IF NOT EXISTS locale text,
--   ADD COLUMN IF NOT EXISTS timezone text,
--   ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- コメント
COMMENT ON TABLE user_device_tokens IS 'ユーザーのExpo Push Token（複合PKで重複禁止）';

-- RLS（有効化のみ）
ALTER TABLE user_device_tokens ENABLE ROW LEVEL SECURITY;
