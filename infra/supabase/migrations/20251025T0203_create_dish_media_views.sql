-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: dish_media_views
-- 役割: 「視聴結果」イベント（impression の 0/1 に対応推奨）
-- =========================

CREATE TABLE IF NOT EXISTS dish_media_views (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- impression との関連（NULL 許容：外部連携等で直接 view が流入するケース想定）
  impression_id  uuid NULL
                 REFERENCES dish_media_impressions(id) ON DELETE CASCADE,

  -- メディア FK
  dish_media_id  uuid NOT NULL
                 REFERENCES dish_media(id) ON DELETE CASCADE,

  -- 視聴者（匿名可）
  user_id        uuid NOT NULL,

  -- 開始時刻
  started_at     timestamptz(6) NOT NULL,

  -- 視聴結果
  watch_ms       integer NOT NULL CHECK (watch_ms >= 0),
  is_completed   boolean NOT NULL,
  is_skipped     boolean NOT NULL,
  rewatch_count  integer NOT NULL CHECK (rewatch_count >= 0),

  -- 互いに排他（同一イベント内で完視聴とスキップの両立は禁止）
  CONSTRAINT chk_view_flags_mutex
    CHECK (NOT (is_completed AND is_skipped))
);

-- 1 impression に最大 1 view を保証したい場合のみ有効化（MVPでは任意）
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_dmv_impression
--   ON dish_media_views (impression_id)
--   WHERE impression_id IS NOT NULL;

-- 集計・参照用インデックス
CREATE INDEX IF NOT EXISTS idx_dmv_media             ON dish_media_views (dish_media_id);
CREATE INDEX IF NOT EXISTS idx_dmv_user_media_time   ON dish_media_views (user_id, dish_media_id, started_at DESC);

-- コメント（テーブル）
COMMENT ON TABLE dish_media_views IS '視聴イベント（view）を記録。impression と 0/1 対応を推奨。匿名視聴も許容。';

-- コメント（カラム）
COMMENT ON COLUMN dish_media_views.id IS '視聴イベントID';
COMMENT ON COLUMN dish_media_views.impression_id IS '対応するインプレッション（NULL可）';
COMMENT ON COLUMN dish_media_views.dish_media_id IS '対象メディア（削除時 CASCADE）';
COMMENT ON COLUMN dish_media_views.user_id IS '視聴ユーザー（匿名は NULL、削除時は NULL）';
COMMENT ON COLUMN dish_media_views.started_at IS '視聴開始時刻';
COMMENT ON COLUMN dish_media_views.watch_ms IS '視聴時間（ms）';
COMMENT ON COLUMN dish_media_views.is_completed IS '完視聴フラグ';
COMMENT ON COLUMN dish_media_views.is_skipped IS 'スキップフラグ';
COMMENT ON COLUMN dish_media_views.rewatch_count IS '同一セッション内の再視聴回数（推定）';

-- RLS 有効化
ALTER TABLE dish_media_views ENABLE ROW LEVEL SECURITY;
