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

-- ⚠️ dish_media_external_embeddings の CREATE TABLE はこのファイルから外した（#1375 との衝突解消）。
--
--    このテーブルは #1395 の
--    20260819T0200_create_dish_media_external_embeddings.sql が作る。**そちらが唯一の作成元**である。
--    かつては両方がそれぞれ別の定義で CREATE TABLE IF NOT EXISTS しており、
--    «先に流れた方が勝ち、後は無言でスキップ» という形で片方の設計が壊れる状態だった
--    （列構成・provider の値域・PK の取り方がすべて食い違っていた）。
--
--    このファイルが必要としていた取り込み系の列
--    （embed_html / rights_basis / availability_status / source_row_hash）は、
--    20260821T0000_add_external_embedding_ingestion_columns.sql が
--    «作成済みのテーブルへ足す ALTER» として追加する。
--    ファイル名がテーブル作成（20260819T0200）より後になっているのは意図的で、
--    適用順が自然に正しくなるようにしてある。

COMMIT;

-- rollback（必要時に手動実施）:
-- DROP INDEX restaurants_source_seed_id_uq;
-- ALTER TABLE restaurants DROP COLUMN source_seed_id, DROP COLUMN source_names,
--   DROP COLUMN source_row_hash, DROP COLUMN synced_at;
-- ALTER TABLE dishes DROP COLUMN data_origin, DROP COLUMN synced_at;
