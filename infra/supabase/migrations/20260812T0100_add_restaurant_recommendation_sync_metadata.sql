-- =============================================================================
-- 店提案 BigQuery catalog の PostgreSQL serving 受け口
-- =============================================================================
--
-- 【方針】
-- - 既存 restaurants / dishes / dish_media の主構造は変えない。
-- - 店舗と料理には、BigQuery同期由来かを識別する最小限のmetadataだけを足す。
-- - SNS媒体固有項目は dish_media を肥大化させず、1:0..1 の子テーブルへ隔離する。
-- - 既存ユーザー投稿は data_origin のdefault値により挙動を一切変えない。
--
-- このmigrationは dev/public の各search_pathで従来どおり適用する。
-- =============================================================================

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS source_seed_id UUID,
  ADD COLUMN IF NOT EXISTS source_names TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_row_hash TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

COMMENT ON COLUMN restaurants.source_seed_id IS
  'restaurant_recommendation.restaurant_seed_catalog のseed_id。名寄せ監査用。';
COMMENT ON COLUMN restaurants.source_names IS
  '店舗基本情報を裏付けたsource名（existing_pg/overture/ifas/osm）。';
COMMENT ON COLUMN restaurants.source_row_hash IS
  'BigQuery publish rowの差分検知hash。';
COMMENT ON COLUMN restaurants.synced_at IS
  'restaurant_recommendation catalogから最後に同期した時刻。';

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_source_seed_id_uq
  ON restaurants(source_seed_id)
  WHERE source_seed_id IS NOT NULL;

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'user_or_google',
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

ALTER TABLE dishes
  DROP CONSTRAINT IF EXISTS dishes_data_origin_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_data_origin_check
  CHECK (data_origin IN ('user_or_google', 'restaurant_recommendation'));

COMMENT ON COLUMN dishes.data_origin IS
  'user_or_google=既存作成経路、restaurant_recommendation=BigQuery生成。';
COMMENT ON COLUMN dishes.synced_at IS
  'restaurant_recommendation catalogから最後に同期した時刻。';

CREATE TABLE IF NOT EXISTS dish_media_external_embeddings (
  dish_media_id       UUID PRIMARY KEY REFERENCES dish_media(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  external_content_id TEXT NOT NULL,
  canonical_url       TEXT NOT NULL,
  embed_html          TEXT NOT NULL,
  thumbnail_url       TEXT,
  availability_status TEXT NOT NULL,
  rights_basis        TEXT NOT NULL,
  terms_version       TEXT,
  published_at        TIMESTAMPTZ,
  last_verified_at    TIMESTAMPTZ NOT NULL,
  source_row_hash     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dish_media_external_provider_check
    CHECK (provider IN ('instagram', 'tiktok', 'x')),
  CONSTRAINT dish_media_external_availability_check
    CHECK (availability_status IN ('available', 'unavailable', 'deleted', 'private', 'ineligible')),
  CONSTRAINT dish_media_external_provider_content_uq
    UNIQUE (provider, external_content_id)
);

CREATE INDEX IF NOT EXISTS dish_media_external_availability_idx
  ON dish_media_external_embeddings(availability_status, last_verified_at DESC);

COMMENT ON TABLE dish_media_external_embeddings IS
  'Instagram/TikTok/X等の外部埋め込み情報。dish_media本体は既存検索・reactionとの互換層。';
COMMENT ON COLUMN dish_media_external_embeddings.embed_html IS
  '公式oEmbed等から得たHTML。API/クライアントでprovider allowlistとCSPを適用して表示する。';
COMMENT ON COLUMN dish_media_external_embeddings.rights_basis IS
  'official_api / official_oembed / partner_license / first_party_permission。';

ALTER TABLE dish_media_external_embeddings ENABLE ROW LEVEL SECURITY;

COMMIT;

-- rollback（必要時に手動実施）:
-- DROP TABLE dish_media_external_embeddings;
-- DROP INDEX restaurants_source_seed_id_uq;
-- ALTER TABLE restaurants DROP COLUMN source_seed_id, DROP COLUMN source_names,
--   DROP COLUMN source_row_hash, DROP COLUMN synced_at;
-- ALTER TABLE dishes DROP COLUMN data_origin, DROP COLUMN synced_at;
