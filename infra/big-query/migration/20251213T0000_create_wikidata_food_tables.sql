-- ==============================================================================
-- 20251213T0000_create_wikidata_food_tables.sql
-- ==============================================================================
-- チケット #533 Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
--
-- ## 目的
-- Wikidata から取得した料理・飲み物のノード＋祖先情報を BigQuery に構造化し、
-- 祖先ベースのブラックリストを適用できる仕組みを構築する。
--
-- ## 使い方
-- スクリプト側から ${DATASET} をプレースホルダ置換して実行される。
-- または、手動で以下のように実行：
--   sed 's/${DATASET}/your_dataset_name/g' 20251213T0000_create_wikidata_food_tables.sql | bq query --use_legacy_sql=false
--
-- ## 処理内容
-- 1. food_roots: ルートクラス定数テーブル作成＋初期データ投入
-- 2. food_nodes_raw: Wikidata から取得したノード情報テーブル作成
-- 3. food_paths: 祖先テーブル作成
-- 4. dish_root_summary: ルート集約ビュー作成
-- 5. dish_ancestor_blacklist: ancestor ブラックリストテーブル作成
-- 6. dish_blacklist: dish ブラックリストテーブル作成
--
-- ## 注意
-- - テーブルは CREATE TABLE IF NOT EXISTS で作成されるため、再実行可能
-- - データ投入は Python スクリプト側で行う（food_roots の初期データ以外）
-- ==============================================================================


-- -----------------------------------------------------------------------------
-- 1. food_roots: ルートクラス定数テーブル
-- -----------------------------------------------------------------------------
-- Wikidata から取得する対象の「ルートクラス（料理・飲み物のトップ階層）」を定義
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.food_roots` (
  root_qid   STRING NOT NULL,   -- 例: 'Q746549'
  kind       STRING NOT NULL    -- 'dish' / 'dessert' / 'beverage' / 'alcoholic_beverage' / 'snack' / 'confectionery' / 'coffee' / 'tea'
);

-- 初期データ投入（MERGE を使って冪等性を確保）
MERGE `${DATASET}.food_roots` AS target
USING (
  SELECT 'Q746549' AS root_qid, 'dish' AS kind UNION ALL
  SELECT 'Q192874', 'noodle' UNION ALL
  SELECT 'Q21976260', 'rice_dish' UNION ALL
  SELECT 'Q16266745', 'flour_based_food' UNION ALL
  SELECT 'Q182940', 'dessert' UNION ALL
  SELECT 'Q40050', 'drink'
) AS source
ON target.root_qid = source.root_qid
WHEN NOT MATCHED THEN
  INSERT (root_qid, kind)
  VALUES (source.root_qid, source.kind);


-- -----------------------------------------------------------------------------
-- 2. food_nodes_raw: ノードテーブル
-- -----------------------------------------------------------------------------
-- Wikidata から取得した「料理・飲み物候補ノード」の原情報
-- root（dish 由来か、beverage 由来か等）は持たず、純粋なノード表とする
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.food_nodes_raw` (
  item_qid   STRING NOT NULL,  -- 例: 'Q12345' （主キー）
  label_ja   STRING,
  label_en   STRING,
  desc_ja    STRING,
  desc_en    STRING
);


-- -----------------------------------------------------------------------------
-- 3. food_paths: 祖先テーブル
-- -----------------------------------------------------------------------------
-- 各ノードの全 ancestor（親・祖父・曾祖父…）を depth 付きで持つ
-- 「この ancestor を持つノードはすべて除外」などの判定に使う
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.food_paths` (
  child_qid     STRING NOT NULL,  -- 子ノード（料理・飲み物候補）
  ancestor_qid  STRING NOT NULL,  -- 祖先ノード
  depth         INT64  NOT NULL   -- child から ancestor までの距離 (0=自分自身, 1=直親, 2=祖父, ...)
);


-- -----------------------------------------------------------------------------
-- 4. dish_root_summary: ルート集約ビュー（分析用）
-- -----------------------------------------------------------------------------
-- 各 dish がどのルートクラス（food_roots）に、何ステップでぶら下がっているかを把握
-- 同じ dish が複数の root にぶら下がる可能性を考慮し、配列構造で保持
-- 
-- 注意: このテーブルは food_paths と food_roots のデータが投入された後に、
--       スクリプト側で再生成される想定
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_root_summary` (
  dish_qid   STRING NOT NULL,
  roots      ARRAY<STRUCT<
                root_qid   STRING,   -- 例: 'Q746549'
                kind       STRING,   -- 'dish' / 'dessert' / 'beverage' ...
                min_depth  INT64     -- その root までの最短距離
              >>
);


-- -----------------------------------------------------------------------------
-- 5. dish_ancestor_blacklist: ancestor ブラックリスト
-- -----------------------------------------------------------------------------
-- 「この ancestor を持つ dish は、とりあえず除外候補にしたい」という人手メンテ用テーブル
-- 例：'Japanese cuisine', 'Italian cuisine', 'wheat', 'species of plant' 的な上位ノード
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_ancestor_blacklist` (
  ancestor_qid   STRING NOT NULL,   -- NG 判定の祖先ノード
  reason         STRING,            -- 'too_generic', 'cuisine', 'ingredient' などのメモ用途
  created_at     TIMESTAMP
);


-- -----------------------------------------------------------------------------
-- 6. dish_blacklist: dish ブラックリスト
-- -----------------------------------------------------------------------------
-- 実際に「この dish はブラックリスト対象」と扱う QID を保持するテーブル
-- ブラック理由は ancestor 以外も将来増やせるようにする
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_blacklist` (
  dish_qid   STRING NOT NULL,   -- NG とする dish
  reason     STRING,            -- 'ancestor', 'manual', 'quality', 'temporary' など
  note       STRING,            -- 任意メモ（ancestor_qid などを文字列で入れてもよい）
  created_at TIMESTAMP
);


-- -----------------------------------------------------------------------------
-- 7. dish_category_catalog: blacklist 除外済み準マスタ
-- -----------------------------------------------------------------------------
-- dish_blacklist に含まれていない dish のカタログ
-- labels/desc/image_url/tags を保持し、本番投入時の候補となる
-- 実データは Python スクリプト側で CREATE OR REPLACE TABLE AS SELECT ... により生成
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_catalog` (
  item_qid  STRING NOT NULL,   -- dish QID
  label_ja  STRING,             -- 日本語ラベル
  label_en  STRING,             -- 英語ラベル
  desc_ja   STRING,             -- 日本語説明
  desc_en   STRING,             -- 英語説明
  image_url STRING,             -- Wikidata 画像 URL（あれば）
  tags      ARRAY<STRING>       -- 祖先 QID の配列（depth<=5 の shallow なもの）
);

ALTER TABLE `${DATASET}.dish_category_catalog`
  -- #543 labels_json: 全言語のラベルを JSON 形式で保持
  ADD COLUMN IF NOT EXISTS labels_json STRING,
  -- #543 descriptions_json: 全言語の説明を JSON 形式で保持
  ADD COLUMN IF NOT EXISTS descriptions_json STRING,
  -- #543 aliases_json: 全言語の別名を JSON 形式で保持
  ADD COLUMN IF NOT EXISTS aliases_json STRING,
  -- #543 sitelinks_json: 全言語のサイトリンクを JSON 形式で保持
  ADD COLUMN IF NOT EXISTS sitelinks_json STRING,
  -- #543 origin_qids: 料理の由来国・地域 QID の配列
  ADD COLUMN IF NOT EXISTS origin_qids ARRAY<STRING>,
  -- #543 cuisine_qids: 料理カテゴリ QID の配列
  ADD COLUMN IF NOT EXISTS cuisine_qids ARRAY<STRING>,
  -- #543 roots: dish_root_summary から取得したルート情報
  ADD COLUMN IF NOT EXISTS roots ARRAY<STRUCT<
    kind STRING,
    min_depth INT64
  >>;


-- -----------------------------------------------------------------------------
-- 8. dish_category_localized_text_catalog: 採用版 localized text カタログ（#582）
-- -----------------------------------------------------------------------------
-- #582 【設計】LLM生成の感情訴求型コピー（topic_title / tagline）の採用版を管理
-- wikidata_food_copy_generations から confidence='high' のみを投入し、常に採用版のみ保持
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_localized_text_catalog` (
  item_qid        STRING NOT NULL,   -- dish_category QID
  locale          STRING NOT NULL,   -- BCP47 形式（'ja', 'en'）
  topic_title     STRING NOT NULL,   -- 感情訴求型タイトル（最大12-14文字）
  tagline         STRING NOT NULL,   -- キャッチコピー（最大45文字）
  source          STRING NOT NULL,   -- 'llm' / 'manual'
  selected_run_id STRING NOT NULL,   -- 採用した run_id（監査・差分比較用）
  updated_at      TIMESTAMP NOT NULL,-- 最終更新日時
  note            STRING             -- 任意メモ（model / pass 情報など）
);


-- -----------------------------------------------------------------------------
-- 9. dish_category_features_catalog: ゲート・ランキング特徴量カタログ
-- -----------------------------------------------------------------------------
-- #557 【設計】dish_category に対する特徴量（gate / mood / scene / taste 等）を統合管理
-- gate 用途（region whitelist）、将来的には mood / scene / timeSlot / taste / archetype も追加
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_features_catalog` (
  item_qid     STRING NOT NULL,  -- dish_category QID
  feature_type STRING NOT NULL,  -- 'gate' | 'mood' | 'scene' | 'timeSlot' | 'taste' | 'archetype' ...
  feature_key  STRING NOT NULL,  -- 'region:scope:global', 'region:country:JP', ...
  score        FLOAT64 NOT NULL, -- gate は 1 固定、他の特徴量では重み付けに使用
  source       STRING NOT NULL,  -- 'llm' | 'manual' | 'rule'
  run_id       STRING NOT NULL,  -- LLM run 識別子（監査・差分比較用）
  updated_at   TIMESTAMP NOT NULL, -- 最終更新日時
  note         STRING             -- 任意メモ（confidence / short reason 等）
);


-- -----------------------------------------------------------------------------
-- 10. dish_category_variant_catalog: variants 加工結果テーブル
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
-- 11. dish_category_images: 画像候補テーブル
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

