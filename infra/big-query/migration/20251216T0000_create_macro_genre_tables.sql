-- ==============================================================================
-- 20251213T0000_create_macro_genre_tables.sql
-- ==============================================================================
-- チケット #550 macro_genre（Wikidata）ホワイトリスト運用＋割当結果テーブル作成（BigQuery）
--
-- ## 目的
-- カテゴリレコメンドAPIのスレート多様性制御のために、各 dish（Wikidata QID）へ
-- 粗い料理枠（macro_genre）を付与する仕組みを構築する。
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20251213T0000_create_macro_genre_tables.sql | bq query --use_legacy_sql=false
--
-- ## 処理内容
-- 1. macro_genre_whitelist: macro_genre として採用する QID の手動運用テーブル
-- 2. food_edges_raw: Wikidata 由来エッジ原票（child→parent）
-- 3. dish_macro_genre_analysis: macro_genre 割当の分析テーブル（曖昧フラグ・候補群）
--
-- ## 注意
-- - テーブルは CREATE TABLE IF NOT EXISTS で作成されるため、再実行可能
-- - analysis の実データ投入は Python スクリプト側で行う
-- - dish_category_catalog は 20251213T0000_create_wikidata_food_tables.sql で定義
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- 1. macro_genre_whitelist: macro_genre 手動運用テーブル
-- -----------------------------------------------------------------------------
-- macro_genre として採用する Wikidata QID を人手で管理するテーブル
-- label は保持しない。表示は food_nodes_raw / dish_category_catalog との JOIN 前提
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.macro_genre_whitelist` (
  item_qid   STRING NOT NULL,   -- macro_genre として採用する QID（例: 'Q5195' for cuisine）
  reason     STRING,             -- メモ用途（例: 'top_level_category', 'regional_cuisine'）
  created_at TIMESTAMP
);


-- -----------------------------------------------------------------------------
-- 2. food_edges_raw: Wikidata 由来エッジ原票
-- -----------------------------------------------------------------------------
-- Wikidata から取得した child→parent のエッジ情報を保持
-- P31 (instance of), P279 (subclass of) を対象
-- 既存実装は P31/P279 を区別しないため property フィールドは持たない
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.food_edges_raw` (
  child_qid  STRING NOT NULL,   -- 子ノード QID
  parent_qid STRING NOT NULL    -- 親ノード QID
);


-- -----------------------------------------------------------------------------
-- 3. dish_macro_genre_analysis: macro_genre 割当の分析テーブル
-- -----------------------------------------------------------------------------
-- macro_genre_whitelist と food_paths を用いて macro_genre を決定
-- 曖昧判定・候補配列をレビュー用に保持
-- 実データは Python スクリプト側で CREATE OR REPLACE TABLE AS SELECT ... により生成
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_macro_genre_analysis` (
  item_qid               STRING NOT NULL,        -- dish QID
  macro_genre_qid        STRING,                 -- 決定された macro_genre QID（曖昧時は NULL）
  macro_genre_depth      INT64,                  -- macro_genre までの最短距離
  macro_genre_ambiguous  BOOLEAN NOT NULL,       -- 曖昧フラグ（複数候補がある場合 true）
  macro_genre_candidates ARRAY<STRUCT<
                           ancestor_qid STRING,  -- 候補 QID
                           depth        INT64    -- 距離
                         >>,                     -- macro_genre 候補の配列（min depth 全件 + 最大 K 件）
  computed_at            TIMESTAMP               -- 計算日時
);
