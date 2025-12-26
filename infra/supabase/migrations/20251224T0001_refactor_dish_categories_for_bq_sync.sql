-- ==============================================================================
-- 20251224T0001_refactor_dish_categories_for_bq_sync.sql
-- #533
-- ==============================================================================
-- 【目的】
-- BigQuery → PostgreSQL 同期基盤のため、dish_categories テーブルを Serving 最適化
-- 
-- 【変更内容】
-- 1. origin, cuisine カラムを削除（BigQuery側でのみ管理）
-- 2. updated_at, lock_no カラムを削除（楽観ロック不要、synced_at で管理）
-- 3. macro_genre_qid カラムを追加（粗い料理枠のWikidata QIDを格納）
-- 4. synced_at カラムを追加（BigQuery同期時刻を記録）
-- 
-- 【背景】
-- - origin/cuisine は BigQuery の dish_category_catalog で origin_qids/cuisine_qids として管理
-- - PostgreSQL は Serving DB として必要最小限のカラムのみ保持
-- - BigQuery を SoT とし、PostgreSQL への同期時刻を synced_at で管理
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- 1) origin カラムを削除
ALTER TABLE dish_categories DROP COLUMN IF EXISTS origin;
COMMENT ON TABLE dish_categories IS '料理カテゴリーマスター（BigQueryからの同期データ、多言語・分類タグなどを含む）';

-- 2) cuisine カラムを削除
ALTER TABLE dish_categories DROP COLUMN IF EXISTS cuisine;

-- 3) updated_at カラムを削除
ALTER TABLE dish_categories DROP COLUMN IF EXISTS updated_at;

-- 4) lock_no カラムを削除
ALTER TABLE dish_categories DROP COLUMN IF EXISTS lock_no;

-- 5) dish_categories に macro_genre_qid カラムを追加
ALTER TABLE dish_categories ADD COLUMN IF NOT EXISTS macro_genre_qid TEXT NULL;
COMMENT ON COLUMN dish_categories.macro_genre_qid IS '料理カテゴリを分類するためのマクロジャンルのWikidata QID（例: ヌードルスープの場合はQ4939235）';

-- 6) synced_at カラムを追加6
ALTER TABLE dish_categories ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
COMMENT ON COLUMN dish_categories.synced_at IS 'BigQueryから最後に同期された日時';

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、以下のコマンドを実行する
-- ALTER TABLE dish_categories ADD COLUMN origin TEXT[] NOT NULL DEFAULT '{}';
-- ALTER TABLE dish_categories ADD COLUMN cuisine TEXT[] NOT NULL DEFAULT '{}';
-- ALTER TABLE dish_categories ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- ALTER TABLE dish_categories ADD COLUMN lock_no INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE dish_categories DROP COLUMN synced_at;
-- ALTER TABLE dish_categories DROP COLUMN IF EXISTS macro_genre_qid;
