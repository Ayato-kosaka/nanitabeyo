-- ==============================================================================
-- 20251215T0000_create_wikidata_food_llm_labels.sql
-- ==============================================================================
-- チケット #548 Wikidata 食品ノードへの LLM ラベリング基盤追加（dish_blacklist 強化）
--
-- ## 目的
-- gpt-4.1-mini によるラベリング結果を保存するテーブルを作成し、
-- LLM ベースの dish_blacklist 強化を可能にする。
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20251215T0000_create_wikidata_food_llm_labels.sql | bq query --use_legacy_sql=false
--
-- ## 処理内容
-- wikidata_food_llm_labels テーブルを作成
--
-- ## 注意
-- - テーブルは CREATE TABLE IF NOT EXISTS で作成されるため、再実行可能
-- - データ投入は Python スクリプト側で行う
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- wikidata_food_llm_labels: LLM ラベリング結果テーブル
-- -----------------------------------------------------------------------------
-- gpt-4.1-mini によるラベリング結果を保存
-- バッチごとに run_id を分けて格納し、後からやり直しや比較ができるようにする
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.wikidata_food_llm_labels` (
  item_qid    STRING NOT NULL,   -- Wikidata QID（food_nodes_raw.item_qid）
  task        STRING NOT NULL,   -- '#548_menu_blacklist_classification' など
  label       STRING NOT NULL,   -- 'keep' / 'too_generic' / 'non_menu_item' / 'not_for_menu' / 'uncertain' など
  confidence  STRING NOT NULL,   -- 'high' / 'medium' / 'low'
  reason      STRING,            -- LLM の簡単な説明（英語）
  model       STRING,            -- 'gpt-4.1-mini' など
  run_id      STRING NOT NULL,   -- バッチ実行ごとの識別子（例: '20251215T0000_v1'）
  created_at  TIMESTAMP NOT NULL -- LLM 結果の登録日時
);
