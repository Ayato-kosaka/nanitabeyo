-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: notifications
-- 役割: 通知本体（集約・i18n・アクター集約）
-- =========================

CREATE TABLE IF NOT EXISTS notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type      text NOT NULL,
  target_table     text NOT NULL,
  target_id        uuid NOT NULL,
  actor_id         uuid NOT NULL,
  i18n_key         text NOT NULL,
  i18n_params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_ids        uuid[] NOT NULL,
  actor_count      int NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- コメント
COMMENT ON TABLE notifications IS '通知レコード本体（行＝通知単位、短時間集約可）';
COMMENT ON COLUMN notifications.id IS '通知ID（UUID v4）';
COMMENT ON COLUMN notifications.i18n_key IS 'クライアントで解決するi18nキー';
COMMENT ON COLUMN notifications.i18n_params IS 'i18nプレースホルダ値';
COMMENT ON COLUMN notifications.actor_ids IS '集約表示用の先頭アクターID群（上限件数推奨）';
COMMENT ON COLUMN notifications.actor_count IS 'アクター総数';

-- RLS（有効化のみ。ポリシーは作らない＝クライアント直アクセス不可）
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
