-- ==============================================================================
-- 20251223T0000_create_wikidata_food_llm_feature_scores.sql
-- ==============================================================================
-- チケット #581 dish_category relevance_scoring（rubric-based feature scoring / Batch API）
--
-- ## 目的
-- dish_category に対する relevance feature スコア（timeSlot / scene / satiety / taste）
-- を LLM で付与し、run_id 単位で管理可能な運用とする。
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20251223T0000_create_wikidata_food_llm_feature_scores.sql | bq query --use_legacy_sql=false
--
-- ## 処理内容
-- wikidata_food_llm_feature_scores テーブルを作成
--
-- ## 注意
-- - テーブルは CREATE TABLE IF NOT EXISTS で作成されるため、再実行可能
-- - データ投入は Python スクリプト側で行う
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- wikidata_food_llm_feature_scores: LLM feature スコアテーブル
-- -----------------------------------------------------------------------------
-- #581 relevance_scoring の Phase1（スコアリング）とPhase2（レビュー）の結果を保存
-- 各 feature_type / feature_key ごとに 1 row で格納
-- 複数 run_id での比較・差分確認が可能
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.wikidata_food_llm_feature_scores` (
  item_qid     STRING NOT NULL,   -- dish_category QID
  feature_type STRING NOT NULL,   -- 'timeSlot' / 'scene' / 'satiety' / 'taste'
  feature_key  STRING NOT NULL,   -- 'morning' / 'solo' / 'hearty' / 'sweet' など
  score        FLOAT64 NOT NULL,  -- 0 / 0.5 / 1 のみ
  confidence   STRING,            -- 'high' / 'medium' / 'low'
  reason       STRING,            -- <= 120 chars（日本語可）
  phase        STRING NOT NULL,   -- 'phase1' / 'phase2'
  task         STRING NOT NULL,   -- '#581_relevance_scoring'
  model        STRING NOT NULL,   -- 'gpt-4.1-mini' など
  run_id       STRING NOT NULL,   -- Batch API run_id（例: '20251223T0000_phase1'）
  created_at   TIMESTAMP NOT NULL -- 登録日時
);
