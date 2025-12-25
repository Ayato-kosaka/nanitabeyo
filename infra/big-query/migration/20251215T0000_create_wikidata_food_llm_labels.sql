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
-- gpt-4.1-mini などによるラベリング結果を保存
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


-- -----------------------------------------------------------------------------
-- wikidata_food_copy_generations: LLM コピー生成結果テーブル（#582）
-- -----------------------------------------------------------------------------
-- #582 【設計】dish_category の感情訴求型コピー（topic_title / tagline）生成結果を保存
-- append-only で全 run を保持し、採用版は dish_category_localized_text_catalog に分離
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.wikidata_food_copy_generations` (
  item_qid    STRING NOT NULL,   -- Wikidata QID（dish_category）
  locale      STRING NOT NULL,   -- BCP47 形式（'ja-JP', 'en'）
  topic_title STRING NOT NULL,   -- 感情訴求型タイトル（最大12-14文字）
  tagline     STRING NOT NULL,   -- キャッチコピー（最大45文字）
  confidence  STRING NOT NULL,   -- 'high' / 'medium' / 'low'
  model       STRING NOT NULL,   -- 'gpt-4.1-mini' / 'gpt-4.1' など
  run_id      STRING NOT NULL,   -- バッチ実行ごとの識別子（例: '20251221T0000_p1'）
  created_at  TIMESTAMP NOT NULL,-- LLM 結果の登録日時
  note        STRING             -- 任意メモ（pass 情報など）
);


-- -----------------------------------------------------------------------------
-- dish_category_variant_catalog: variants 加工結果テーブル
-- -----------------------------------------------------------------------------
-- BigQuery で生成した variants の格納先
-- PostgreSQL への同期元となる
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_variant_catalog` (
  dish_category_id STRING NOT NULL,   -- dish_category QID
  surface_form     STRING NOT NULL,   -- 正規化済み表記揺れ（小文字）
  source           STRING NOT NULL,   -- 'wikidata-label' / 'kata2hira' / 'romaji' / 'canonical-label-en'
  created_at       TIMESTAMP NOT NULL -- 生成日時
);


-- -----------------------------------------------------------------------------
-- dish_category_images: 画像候補テーブル
-- -----------------------------------------------------------------------------
-- dish_category に対する画像候補を管理
-- 優先順位：manual > analysis > wikimedia > partner
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_images` (
  dish_category_id STRING NOT NULL,   -- dish_category QID
  image_url        STRING NOT NULL,   -- 画像URL
  source_type      STRING NOT NULL,   -- 'wikimedia' / 'analysis' / 'manual' / 'partner'
  source_ref       STRING,            -- Wikidata property id / 分析ジョブid / ユーザーid / パートナーid
  score            FLOAT64,           -- 品質推定、CTR、解像度、NSFW検査結果など（分析ジョブ実行時に付与）
  created_at       TIMESTAMP NOT NULL -- 登録日時
);

