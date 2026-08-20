-- manual/2_merge_feature_scores.py が実行する汎用 MERGE SQL（#1383）
--
-- 【目的】
-- 指定 run_id の wikidata_food_llm_feature_scores を、BigQuery 採用版
-- dish_category_features_catalog に安全に差分MERGEする。
--
-- 【この SQL の設計方針】
-- sql/merge_phase2_features_catalog_20260718.sql（#853）の安全設計を汎用化したもの。
-- 相違点は、target_run_id / expected_row_count / expected_item_count を
-- SQL へハードコードしないこと（#1383 で「特定案件のようにexpected countをSQLへ
-- ハードコードしない」ことが明示的に求められている）。
-- 件数の期待値チェックは呼び出し元の Python 側（manual/2_merge_feature_scores.py の
-- --expected-row-count / --expected-item-count）で行う。
--
-- 【責務】
-- - @run_id の LLM feature score / manual correction を採用版へ MERGE する。
-- - 同一 (item_qid, feature_type, feature_key) が既にある場合は score/note を更新する。
-- - 既存 catalog にない key が含まれていた場合は INSERT する。
-- - 空 run / 不正 score / 重複 key / catalog 外 QID を ASSERT で止める。
--
-- 【パラメータ】
-- @run_id STRING（必須）
--
-- 【実行方法】
-- このファイルは manual/2_merge_feature_scores.py から
-- google-cloud-bigquery の QueryJobConfig(query_parameters=[...]) 経由で実行する想定。
-- `bq query` から直接流す場合は --parameter 'run_id:STRING:<値>' を渡すこと。

-- ---------------------------------------------------------------------------
-- Precheck: source が空ではないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) > 0
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = @run_id
) AS 'source run is empty';

-- ---------------------------------------------------------------------------
-- Precheck: 必須列と score が壊れていないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = @run_id
    AND (
      item_qid IS NULL OR item_qid = ''
      OR feature_type IS NULL OR feature_type = ''
      OR feature_key IS NULL OR feature_key = ''
      OR score IS NULL
      OR score < 0 OR score > 1
      OR task IS NULL OR task = ''
      OR phase IS NULL OR phase = ''
      OR model IS NULL OR model = ''
    )
) AS 'source has invalid rows (null/empty required column or score out of [0,1])';

-- ---------------------------------------------------------------------------
-- Precheck: BigQuery 側に PK は無いため、MERGE source の key 重複を禁止する。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM (
    SELECT item_qid, feature_type, feature_key
    FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
    WHERE run_id = @run_id
    GROUP BY item_qid, feature_type, feature_key
    HAVING COUNT(*) > 1
  )
) AS 'source has duplicate item_qid/feature_type/feature_key rows';

-- ---------------------------------------------------------------------------
-- Precheck: catalog 外 QID を採用版に混ぜない。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM (
    SELECT DISTINCT s.item_qid
    FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores` s
    LEFT JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` c
      ON c.item_qid = s.item_qid
    WHERE s.run_id = @run_id
      AND c.item_qid IS NULL
  )
) AS 'source contains item_qids that are not in dish_category_catalog';

-- ---------------------------------------------------------------------------
-- Mutation: @run_id を採用版へ MERGE
-- ---------------------------------------------------------------------------
MERGE `food-scroll.wikidata_food_graph.dish_category_features_catalog` AS target
USING (
  SELECT
    item_qid,
    feature_type,
    feature_key,
    score,
    confidence,
    reason,
    model,
    phase,
    task,
    run_id,
    created_at
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = @run_id
) AS source
ON target.item_qid = source.item_qid
  AND target.feature_type = source.feature_type
  AND target.feature_key = source.feature_key
WHEN MATCHED THEN
  UPDATE SET
    score = source.score,
    source = source.model,
    run_id = source.run_id,
    updated_at = CURRENT_TIMESTAMP(),
    note = TO_JSON_STRING(STRUCT(
      source.confidence AS confidence,
      source.reason AS reason,
      source.model AS model,
      source.phase AS phase,
      source.task AS task,
      source.run_id AS source_run_id,
      source.created_at AS source_created_at
    ))
WHEN NOT MATCHED THEN
  INSERT (
    item_qid,
    feature_type,
    feature_key,
    score,
    source,
    run_id,
    updated_at,
    note
  )
  VALUES (
    source.item_qid,
    source.feature_type,
    source.feature_key,
    source.score,
    source.model,
    source.run_id,
    CURRENT_TIMESTAMP(),
    TO_JSON_STRING(STRUCT(
      source.confidence AS confidence,
      source.reason AS reason,
      source.model AS model,
      source.phase AS phase,
      source.task AS task,
      source.run_id AS source_run_id,
      source.created_at AS source_created_at
    ))
  );

-- ---------------------------------------------------------------------------
-- Postcheck
-- ---------------------------------------------------------------------------
SELECT
  run_id,
  feature_type,
  feature_key,
  COUNT(*) AS row_count,
  COUNT(DISTINCT item_qid) AS item_count
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE run_id = @run_id
GROUP BY run_id, feature_type, feature_key
ORDER BY feature_type, feature_key;

SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT item_qid) AS total_items,
  COUNTIF(feature_type = 'gate' AND feature_key = 'region:country:JP' AND score > 0) AS positive_jp_gate_rows
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`;
