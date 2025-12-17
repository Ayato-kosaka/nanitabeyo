-- ==============================================================================
-- 20251217T0000_add_dish_category_catalog_fields.sql
-- ==============================================================================
-- チケット #543 dish_category_catalog の最新化スクリプト追加（core + graph）
--
-- ## 目的
-- dish_category_catalog テーブルに、Wikidata から取得する追加フィールドを追加する
-- - labels_json, descriptions_json, aliases_json, sitelinks_json
-- - origin_qids, cuisine_qids
-- - roots (dish_root_summary から取得)
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20251217T0000_add_dish_category_catalog_fields.sql | bq query --use_legacy_sql=false
--
-- ## 注意
-- - 既存のカラムがある場合は ALTER TABLE IF NOT EXISTS を使って冪等性を確保
-- - 既存データは保持される
-- ==============================================================================

-- labels_json: 全言語のラベルを JSON 形式で保持
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS labels_json STRING;

-- descriptions_json: 全言語の説明を JSON 形式で保持
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS descriptions_json STRING;

-- aliases_json: 全言語の別名を JSON 形式で保持
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS aliases_json STRING;

-- sitelinks_json: 全言語のサイトリンクを JSON 形式で保持
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS sitelinks_json STRING;

-- origin_qids: 料理の由来国・地域 QID の配列
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS origin_qids ARRAY<STRING>;

-- cuisine_qids: 料理カテゴリ QID の配列
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS cuisine_qids ARRAY<STRING>;

-- roots: dish_root_summary から取得したルート情報
ALTER TABLE `${DATASET}.dish_category_catalog`
ADD COLUMN IF NOT EXISTS roots ARRAY<STRUCT<
  kind STRING,      -- 'dish' / 'dessert' / 'drink' など
  min_depth INT64   -- その root までの最短距離
>>;
