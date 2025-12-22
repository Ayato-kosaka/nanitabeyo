-- #572 【SQL】features 投入（dish_category_features_catalog への MERGE）
-- 
-- 【目的】
-- 期待値計算結果を dish_category_features_catalog に反映
-- 
-- 【処理内容】
-- - feature_type='market_salience'
-- - feature_key='region:country:JP'
-- - score = expected_score
-- - source='llm'
-- - note に confidence, is_regional, model, task を JSON で格納
-- 
-- 【MERGE 方針】
-- - 既存の同一 (item_qid, feature_type, feature_key) を更新
-- - 存在しない場合は新規追加

MERGE `${DATASET}.dish_category_features_catalog` AS target
USING (
  -- #572 【設計】期待値計算結果をソースとして使用
  WITH expected_values AS (
    ${AGGREGATE_EXPECTED_VALUE_QUERY}
  )
  SELECT
    item_qid,
    'market_salience' AS feature_type,
    '${FEATURE_KEY}' AS feature_key,
    expected_score AS score,
    'llm' AS source,
    '${PUBLISH_RUN_ID}' AS run_id,
    CURRENT_TIMESTAMP() AS updated_at,
    -- #572 【設計】note に confidence, is_regional, model, task を JSON で格納
    TO_JSON_STRING(STRUCT(
      confidence AS confidence,
      is_regional AS is_regional,
      '${MODEL_PASS1}' AS model_p1,
      '${MODEL_PASS2}' AS model_p2,
      '${TASK_PASS1}' AS task_p1,
      '${TASK_PASS2}' AS task_p2,
      source_pass AS source_pass
    )) AS note
  FROM expected_values
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
  INSERT (item_qid, feature_type, feature_key, score, source, run_id, updated_at, note)
  VALUES (source.item_qid, source.feature_type, source.feature_key, source.score, source.source, source.run_id, source.updated_at, source.note)
;
