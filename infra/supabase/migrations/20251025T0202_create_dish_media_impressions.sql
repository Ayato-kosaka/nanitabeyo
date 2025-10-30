-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: dish_media_impressions
-- 役割: 「表示」イベント
-- RLS: 自分のデータのみ INSERT を許可（SELECT/UPDATE/DELETE は不許可）
-- =========================

CREATE TABLE IF NOT EXISTS dish_media_impressions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 参照
  dish_media_id uuid NOT NULL
                REFERENCES dish_media(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,

  -- 同一セッション識別（匿名可）
  session_id    uuid NULL,

  -- どこで表示されたか（例: for_you, search, profile）
  source        text NULL,

  -- 監査
  created_at    timestamptz(6) NOT NULL DEFAULT now()
);

-- 参照・疲労ペナルティ用インデックス
CREATE INDEX IF NOT EXISTS idx_dmi_media               ON dish_media_impressions (dish_media_id);
CREATE INDEX IF NOT EXISTS idx_dmi_user_media_time     ON dish_media_impressions (user_id, dish_media_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dmi_created_at          ON dish_media_impressions (created_at DESC);

-- コメント（テーブル）
COMMENT ON TABLE dish_media_impressions IS 'メディアがユーザーに表示された「インプレッション」イベントを記録';

-- コメント（カラム）
COMMENT ON COLUMN dish_media_impressions.id IS 'インプレッションID';
COMMENT ON COLUMN dish_media_impressions.dish_media_id IS '対象メディア（削除時 CASCADE）';
COMMENT ON COLUMN dish_media_impressions.user_id IS '表示対象ユーザー（匿名の場合 NULL、削除時は NULL）';
COMMENT ON COLUMN dish_media_impressions.session_id IS '同一ブラウズ中のセッション識別子';
COMMENT ON COLUMN dish_media_impressions.source IS '表示コンテキスト（for_you, search, profile 等）';
COMMENT ON COLUMN dish_media_impressions.created_at IS 'イベント発生時刻';

-- ========== RLS 設定 ==========
ALTER TABLE dish_media_impressions ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーのみ INSERT 可（自分の user_id に限る）
-- ※他操作（SELECT/UPDATE/DELETE）はポリシー未定義 = 不許可
CREATE POLICY "Authenticated users can insert their own impressions"
  ON dish_media_impressions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

