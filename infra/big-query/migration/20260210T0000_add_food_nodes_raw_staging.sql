-- ==============================================================================
-- 20260210T0000_add_food_nodes_raw_staging.sql
-- ==============================================================================
-- チケット #741 Wikidata Food Graph Step2 のロード堅牢化（Load Job + staging + MERGE / rootsテーブル駆動）
--
-- ## 目的
-- Load Job（JSONL）による一括ロードの受け皿として staging テーブルを追加する。
-- streaming insert（insert_rows_json）の欠損・部分失敗リスクを排除し、
-- staging → raw への MERGE により累積運用・冪等性・観測性を確保する。
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20260210T0000_add_food_nodes_raw_staging.sql | bq query --use_legacy_sql=false
--
-- ## 処理内容
-- 1. food_nodes_raw_staging: staging テーブル作成
--    - スキーマは food_nodes_raw と同一
--    - CLUSTER BY item_qid で検索効率化
--
-- ## 注意
-- - CREATE TABLE IF NOT EXISTS で作成されるため、再実行可能
-- - 既存の food_nodes_raw には影響しない
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- 1. food_nodes_raw_staging: ノード staging テーブル
-- -----------------------------------------------------------------------------
-- Load Job（JSONL）でノードデータを一括投入する受け皿
-- food_nodes_raw への MERGE 元として使用
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.food_nodes_raw_staging` (
  item_qid   STRING NOT NULL,  -- 例: 'Q12345' （主キー相当）
  label_ja   STRING,
  label_en   STRING,
  desc_ja    STRING,
  desc_en    STRING
)
CLUSTER BY item_qid;  -- #741 【設計】検索効率化のためのクラスタリング
