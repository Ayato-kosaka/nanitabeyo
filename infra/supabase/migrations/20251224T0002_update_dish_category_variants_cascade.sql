-- ==============================================================================
-- 20251224T0002_update_dish_category_variants_cascade.sql
-- ==============================================================================
-- 【目的】
-- dish_category_variants の FK 制約を ON DELETE CASCADE に変更
-- 
-- 【変更内容】
-- 1. 既存の FK 制約を削除
-- 2. ON DELETE CASCADE 付きの FK 制約を追加
-- 
-- 【背景】
-- - BigQuery → PostgreSQL 同期時に親カテゴリが削除されると自動的に variants も削除
-- - 物理削除戦略の採用により CASCADE が必須
-- 
-- 【ロールバック】
-- - ALTER TABLE dish_category_variants DROP CONSTRAINT dish_category_variants_dish_category_id_fkey;
-- - ALTER TABLE dish_category_variants ADD CONSTRAINT dish_category_variants_dish_category_id_fkey
--     FOREIGN KEY (dish_category_id) REFERENCES dish_categories(id);
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- 1) 既存の FK 制約を削除
ALTER TABLE dish_category_variants 
  DROP CONSTRAINT IF EXISTS dish_category_variants_dish_category_id_fkey;

-- 2) ON DELETE CASCADE 付きの FK 制約を追加
ALTER TABLE dish_category_variants 
  ADD CONSTRAINT dish_category_variants_dish_category_id_fkey 
  FOREIGN KEY (dish_category_id) 
  REFERENCES dish_categories(id) 
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT dish_category_variants_dish_category_id_fkey ON dish_category_variants 
  IS '親カテゴリ削除時に自動的に variants も削除（BigQuery同期の物理削除対応）';

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、以下のコマンドを実行する
-- ALTER TABLE dish_category_variants DROP CONSTRAINT dish_category_variants_dish_category_id_fkey;
-- ALTER TABLE dish_category_variants ADD CONSTRAINT dish_category_variants_dish_category_id_fkey
--   FOREIGN KEY (dish_category_id) REFERENCES dish_categories(id);
