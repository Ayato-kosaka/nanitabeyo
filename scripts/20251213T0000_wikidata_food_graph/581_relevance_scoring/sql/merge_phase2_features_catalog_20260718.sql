-- #853 料理提案精度改善: phase2 を dish_category_features_catalog に MERGE する SQL
--
-- 【目的】
-- phase1 全置換後の `dish_category_features_catalog` に対して、
-- `wikidata_food_llm_feature_scores` の phase2 run を差分反映する。
--
-- 【責務】
-- - `target_run_id` の LLM feature score を採用版へ MERGE する。
-- - 同一 `(item_qid, feature_type, feature_key)` が既にある場合は score/note を更新する。
-- - 既存 catalog にない key が phase2 に含まれていた場合は INSERT する。
-- - 空 run / 不正 score / 重複 key / catalog 外 QID を ASSERT で止める。
--
-- 【今回の想定】
-- - target_run_id: `20260718_phase2_#853_料理提案精度改善_202607`
-- - source rows: 124
-- - source items: 122
-- - feature_type/key: `timeSlot:morning`, `timeSlot:dinner`
--   - `timeSlot:morning`: 120 rows
--   - `timeSlot:dinner`: 4 rows
-- - phase1 catalog には同一 key が全件存在するため、通常は 124 rows 更新のみになる。
--
-- 【実行コマンド例】
-- bq query --use_legacy_sql=false \
--   < scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/sql/merge_phase2_features_catalog_20260718.sql

DECLARE target_run_id STRING DEFAULT '20260718_phase2_#853_料理提案精度改善_202607';
DECLARE expected_row_count INT64 DEFAULT 124;
DECLARE expected_item_count INT64 DEFAULT 122;

-- ---------------------------------------------------------------------------
-- Precheck: source が空ではないこと、今回想定の件数からズレていないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = expected_row_count
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
) AS 'phase2 source row count does not match expected_row_count';

ASSERT (
  SELECT COUNT(DISTINCT item_qid) = expected_item_count
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
) AS 'phase2 source item count does not match expected_item_count';

-- ---------------------------------------------------------------------------
-- Precheck: 必須列と score が壊れていないこと
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
  WHERE run_id = target_run_id
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
) AS 'phase2 source has invalid rows';

-- ---------------------------------------------------------------------------
-- Precheck: BigQuery 側に PK は無いため、MERGE source の key 重複を禁止する。
-- ---------------------------------------------------------------------------
ASSERT (
  SELECT COUNT(*) = 0
  FROM (
    SELECT item_qid, feature_type, feature_key
    FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
    WHERE run_id = target_run_id
    GROUP BY item_qid, feature_type, feature_key
    HAVING COUNT(*) > 1
  )
) AS 'phase2 source has duplicate item_qid/feature_type/feature_key rows';

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
    WHERE s.run_id = target_run_id
      AND c.item_qid IS NULL
  )
) AS 'phase2 source contains item_qids that are not in dish_category_catalog';

-- ---------------------------------------------------------------------------
-- Mutation: phase2 を採用版へ MERGE
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
  WHERE run_id = target_run_id
) AS source
ON target.item_qid = source.item_qid
  AND target.feature_type = source.feature_type
  AND target.feature_key = source.feature_key
WHEN MATCHED THEN
  UPDATE SET
    score = source.score,
    source = source.model,
    run_id = target_run_id,
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
    target_run_id,
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
WHERE run_id = target_run_id
GROUP BY run_id, feature_type, feature_key
ORDER BY feature_type, feature_key;

SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT item_qid) AS total_items,
  COUNTIF(feature_type = 'gate' AND feature_key = 'region:country:JP' AND score > 0) AS positive_jp_gate_rows
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`;
