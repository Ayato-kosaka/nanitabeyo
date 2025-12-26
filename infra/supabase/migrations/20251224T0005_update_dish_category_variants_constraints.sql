-- ==============================================================================
-- 20251224T0002_update_dish_category_variants_constraints.sql
-- #533
-- ==============================================================================
-- 【目的】
-- 1) dish_category_variants の FK 制約を ON DELETE CASCADE に変更
-- 2) BigQuery → PostgreSQL 同期を DELETE/INSERT ではなく UPSERT に移行できるように、
--    UPSERT 用の競合キー（dish_category_id, surface_form）の一意性をDB側で保証する
--
-- 【背景】
-- - 物理削除戦略により、親 dish_categories が削除された場合 variants も自動削除が必要（CASCADE）
-- - 同期処理は全置換（DELETE/INSERT）だと破壊的・競合に弱いので UPSERT に寄せたい
-- - ただし surface_form は UNIQUE のため、別カテゴリで同一 surface_form が来たら落としたい
--   → UPSERT の conflict target は (dish_category_id, surface_form) にし、
--     surface_form 単体 UNIQUE は維持する（衝突時に例外で落ちる）
--
-- 【実装方針】
-- - FK: dish_category_variants(dish_category_id) -> dish_categories(id) ON DELETE CASCADE
-- - UNIQUE: (dish_category_id, surface_form) を追加（UPSERT対象）
-- - UNIQUE: surface_form 単体は既存を尊重。無ければ追加（衝突で落とすため）
--
-- 【ロールバック】
-- - 追加した UNIQUE INDEX を削除
-- - FK を CASCADE なしに戻す
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- 0) 事前：NULL/空文字が混入していると意図せず落ちるので、
--    もし許容しないならアプリ側・同期側で除外推奨。
--    （このマイグレではデータ修正はしない）

-- 1) FK を ON DELETE CASCADE に変更
ALTER TABLE dish_category_variants
  DROP CONSTRAINT IF EXISTS dish_category_variants_dish_category_id_fkey;

ALTER TABLE dish_category_variants
  ADD CONSTRAINT dish_category_variants_dish_category_id_fkey
  FOREIGN KEY (dish_category_id)
  REFERENCES dish_categories(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT dish_category_variants_dish_category_id_fkey ON dish_category_variants
  IS '親カテゴリ削除時に自動的に variants も削除（BigQuery同期の物理削除対応）';

-- 2) UPSERT 用の一意性を追加： (dish_category_id, surface_form)
--    これにより、同期側で以下が可能になる:
--    ON CONFLICT (dish_category_id, surface_form) DO UPDATE ...
CREATE UNIQUE INDEX IF NOT EXISTS dish_category_variants_cat_surface_uq
  ON dish_category_variants (dish_category_id, surface_form);

COMMENT ON INDEX dish_category_variants_cat_surface_uq
  IS 'UPSERT conflict target 用: dish_category_id + surface_form の一意性';

-- 3) surface_form 単体 UNIQUE は「別カテゴリで同じ surface_form が来たら落とす」ために維持
--    既に存在する場合は何もしない。存在しない場合のみ作る。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'dish_category_variants_surface_uq'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX dish_category_variants_surface_uq ON dish_category_variants (surface_form)';
    EXECUTE 'COMMENT ON INDEX dish_category_variants_surface_uq IS ''surface_form 単体の一意性（別カテゴリで同一 surface_form を投入したら例外で落とす）''';
  END IF;
END $$;

-- =========================================
-- Down (rollback)
-- =========================================

-- 3) 追加した unique index を削除（存在すれば）
-- DROP INDEX IF EXISTS dish_category_variants_cat_surface_uq;

-- surface_form 単体 UNIQUE は「既存を尊重」したいケースが多いので、
-- このマイグレで新規作成したかどうかの判定が難しい。
-- 確実に戻したい場合のみ drop してください。
-- DROP INDEX IF EXISTS dish_category_variants_surface_uq;

-- 1) FK を CASCADE なしに戻す
-- ALTER TABLE dish_category_variants
--   DROP CONSTRAINT IF EXISTS dish_category_variants_dish_category_id_fkey;

-- ALTER TABLE dish_category_variants
--   ADD CONSTRAINT dish_category_variants_dish_category_id_fkey
--   FOREIGN KEY (dish_category_id)
--   REFERENCES dish_categories(id);
