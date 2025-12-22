-- #575 【SQL】dish_category_features_catalog へ features 投入
-- 
-- 【目的】
-- wikidata_food_llm_labels から dine_out_orderability feature を
-- dish_category_features_catalog に MERGE（upsert）する
-- 
-- 【仕様】
-- - feature_type = 'dine_out_orderability'
-- - feature_key = 'global'
-- - score = {0, 0.5, 1}
-- - source = 'llm'
-- - run_id = publish_run_id
-- - note = JSON（confidence, model, task）

MERGE `${DATASET}.dish_category_features_catalog` AS target
USING (
  SELECT
    item_qid,
    'dine_out_orderability' AS feature_type,
    'global' AS feature_key,
    CAST(label AS FLOAT64) AS score,
    'llm' AS source,
    '${PUBLISH_RUN_ID}' AS run_id,
    CURRENT_TIMESTAMP() AS updated_at,
    TO_JSON_STRING(
      STRUCT(
        confidence,
        model,
        '${TASK}' AS task
      )
    ) AS note
  FROM `${DATASET}.wikidata_food_llm_labels`
  WHERE task = '${TASK}'
    AND run_id = '${RUN_ID}'
    AND label IS NOT NULL
) AS source
ON target.item_qid = source.item_qid
  AND target.feature_type = source.feature_type
  AND target.feature_key = source.feature_key
WHEN MATCHED THEN
  UPDATE SET
    score = source.score,
    source = source.source,
    run_id = source.run_id,
    updated_at = source.updated_at,
    note = source.note
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
    source.source,
    source.run_id,
    source.updated_at,
    source.note
  )
;
