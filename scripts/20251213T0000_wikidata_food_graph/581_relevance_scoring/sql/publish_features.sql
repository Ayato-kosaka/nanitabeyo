-- #581 【SQL】relevance features を dish_category_features_catalog に投入
-- 
-- 【目的】
-- wikidata_food_llm_feature_scores から最終スコアを抽出し、
-- dish_category_features_catalog に MERGE 反映する
-- 
-- 【ルール】
-- - Phase2 が存在する場合は Phase2 を優先
-- - なければ Phase1 を採用
-- - deny レコードは除外
-- 
-- 【投入先】
-- dish_category_features_catalog
--   feature_type: 'timeSlot' / 'scene' / 'appetite' / 'taste'
--   feature_key: 各 key
--   score: 0 / 0.5 / 1
--   source: 'llm'
--   run_id: ${FINAL_RUN_ID}

-- 最終スコアを決定（Phase2 優先、deny 除外）
WITH phase_priority AS (
  SELECT
    item_qid,
    feature_type,
    feature_key,
    score,
    confidence,
    reason,
    model,
    run_id,
    phase,
    -- Phase2 を優先（ROW_NUMBER で phase2 を先頭に）
    ROW_NUMBER() OVER (
      PARTITION BY item_qid, feature_type, feature_key
      ORDER BY 
        CASE phase WHEN 'phase2' THEN 1 ELSE 2 END,
        created_at DESC
    ) AS priority
  FROM `${DATASET}.wikidata_food_llm_feature_scores`
  WHERE task = '${TASK}'
    AND run_id LIKE '${RUN_ID_PREFIX}%'
    -- deny は除外（confidence が 'deny' の場合は除外）
    AND confidence != 'deny'
),
final_scores AS (
  SELECT
    item_qid,
    feature_type,
    feature_key,
    score,
    confidence,
    reason,
    model,
    run_id,
    phase
  FROM phase_priority
  WHERE priority = 1
)
-- MERGE で投入（既存の同じ feature_type/feature_key は更新、なければ挿入）
MERGE `${DATASET}.dish_category_features_catalog` AS target
USING final_scores AS source
ON target.item_qid = source.item_qid
  AND target.feature_type = source.feature_type
  AND target.feature_key = source.feature_key
WHEN MATCHED THEN
  UPDATE SET
    score = source.score,
    source = 'llm',
    run_id = '${FINAL_RUN_ID}',
    updated_at = CURRENT_TIMESTAMP(),
    note = TO_JSON_STRING(STRUCT(
      source.confidence AS confidence,
      source.reason AS reason,
      source.model AS model,
      source.phase AS phase,
      source.run_id AS source_run_id
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
    'llm',
    '${FINAL_RUN_ID}',
    CURRENT_TIMESTAMP(),
    TO_JSON_STRING(STRUCT(
      source.confidence AS confidence,
      source.reason AS reason,
      source.model AS model,
      source.phase AS phase,
      source.run_id AS source_run_id
    ))
  )
;
