-- 変更チケット: レストラン画像のストレージ/配信リニューアル #413
-- ## 内容
-- - `restaurants` に **原本キー** を格納する `image_path`（TEXT）を追加する。
-- - 既存の `image_url` は **非推奨 (deprecate)** とし、当面は残す。
-- - まずは `image_path` を **NULL 許容で追加 → バックフィル → 検証 → NOT NULL & CHECK 付与** の順で厳格化する。
-- - バックフィル方針
--    restaurant_id` ごとに **最古の dishes** → その **最古の dish_media** の `thumbnail_path` を使用（存在すれば）。
-- - すべての `restaurants` レコードに、`image_path` が `development/google-maps/photo/` または `production/google-maps/photo/` で始まることを検証し、満たさなければ失敗させる。
------------------------------------------------------------------------------------------------------------------------------------------
-- ## 背景 / 目的
-- - 直接 `image_url` を返す構成だと、CDN/ドメイン変更・キャッシュ制御・画質最適化の柔軟性が低い。
-- - **原本キー（image_path）を保存**し、用途別にバックエンドが **リサイズURLを生成**して返す構成へ移行する。
-- - レストラン画像は **1件/店舗**・**bulk-import** で作成される前提（GCSアップロード → 非同期リサイズ）。
----------------------------------------------------------------------
-- ## ロールバック
-- - `ALTER TABLE restaurants DROP COLUMN image_path;` で元に戻せる（バックフィルで埋めた値は失われる）。
-- - 付与した CHECK 制約も削除する。
------------------------
-- =========================================
-- Up
-- =========================================
BEGIN;

-- 1) 新カラムをまずは NULL 許容で追加
ALTER TABLE restaurants
ADD COLUMN image_path TEXT;

COMMENT ON COLUMN restaurants.image_path IS 'レストラン画像の原本キー。API 層で用途別リサイズURLを生成する。';

-- 参考: 非推奨マークをコメントで明示
COMMENT ON COLUMN restaurants.image_url IS '【DEPRECATED】将来的に参照停止予定。代わりに image_path を使用し、API がリサイズURLを生成。';

-- 2) 店舗に対し、最古の dish / 最古の dish_media の thumbnail_path を採用
WITH
  earliest_dish AS (
    SELECT DISTINCT
      ON (d.restaurant_id) d.restaurant_id,
      d.id AS dish_id
    FROM
      dishes d
    ORDER BY
      d.restaurant_id,
      d.created_at ASC,
      d.id ASC
  ),
  earliest_media AS (
    SELECT DISTINCT
      ON (dm.dish_id) dm.dish_id,
      dm.thumbnail_path
    FROM
      dish_media dm
    ORDER BY
      dm.dish_id,
      dm.created_at ASC,
      dm.id ASC
  ),
  chosen AS (
    SELECT
      ed.restaurant_id,
      em.thumbnail_path
    FROM
      earliest_dish ed
      JOIN earliest_media em ON em.dish_id = ed.dish_id
    WHERE
      em.thumbnail_path IS NOT NULL
  )
UPDATE restaurants r
SET
  image_path = c.thumbnail_path
FROM
  chosen c
WHERE
  r.image_path IS NULL
  AND r.id = c.restaurant_id;

-- 3) バリデーション：全件が所定プレフィックスで埋まっていること
DO $$
DECLARE
total   integer;
matched integer;
missing integer;
BEGIN
SELECT COUNT(*) INTO total FROM restaurants;

SELECT COUNT(*) INTO matched
FROM restaurants
WHERE image_path IS NOT NULL
AND (
image_path LIKE 'development/google-maps/photo/%'
OR image_path LIKE 'production/google-maps/photo/%'
);

missing := total - matched;

IF missing > 0 THEN
RAISE EXCEPTION
'Backfill for image_path failed: % restaurants missing valid image_path',
missing
USING HINT = '各店舗に image_url か dish_media.thumbnail_path を用意してください（prefix: development/ or production/ の google-maps/photo/）。';
END IF;
END $$;

-- 4) 厳格化：NOT NULL と prefix チェック制約を付与
ALTER TABLE restaurants
ALTER COLUMN image_path
SET NOT NULL;

COMMIT;

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、追加した制約とカラムを削除する
-- （注意：image_path にバックフィルした値は失われます）
-- BEGIN;
-- ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_image_path_prefix_chk;
-- ALTER TABLE restaurants DROP COLUMN IF EXISTS image_path;
-- -- コメントは任意で戻す（必要なら）
-- COMMENT ON COLUMN restaurants.image_url IS NULL;
-- COMMIT;
-- =========================================
-- 補足（大規模向け任意）: 事前に作っておくと良いインデックス（別マイグレーションで CONCURRENTLY 実施）
-- =========================================
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dishes_restaurant_created
--   ON dishes (restaurant_id, created_at, id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dish_media_dish_created
--   ON dish_media (dish_id, created_at, id);
-- 同一トランザクション不可のため、上記は別ファイルで実施してください。