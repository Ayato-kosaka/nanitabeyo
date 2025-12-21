-- #572 【SQL】期待値（expected_score）集計
-- 
-- 【目的】
-- Pass1 と Pass2 の結果を統合し、item_qid ごとに最終スコアを決定
-- 
-- 【ルール】
-- - Pass2 が存在する item は Pass2 の結果を採用
-- - Pass2 がない item は Pass1 を採用
-- 
-- 【出力】
-- - item_qid
-- - expected_score (最終スコア)
-- - confidence (最終 confidence)
-- - is_regional (最終 is_regional フラグ)
-- - source_pass (p1 or p2)

WITH p1_results AS (
  SELECT
    item_qid,
    CAST(label AS FLOAT64) AS score,
    confidence,
    -- #572 【設計】reason から is_regional を抽出（暫定：reason に "regional" が含まれる場合）
    -- 実際には別カラムで格納される想定だが、既存スキーマに合わせて reason から判定
    CASE
      WHEN LOWER(reason) LIKE '%regional%' THEN TRUE
      ELSE FALSE
    END AS is_regional
  FROM `${DATASET}.wikidata_food_llm_labels`
  WHERE task = '${TASK_PASS1}'
    AND run_id = '${RUN_ID_PASS1}'
),
p2_results AS (
  SELECT
    item_qid,
    CAST(label AS FLOAT64) AS score,
    confidence,
    CASE
      WHEN LOWER(reason) LIKE '%regional%' THEN TRUE
      ELSE FALSE
    END AS is_regional
  FROM `${DATASET}.wikidata_food_llm_labels`
  WHERE task = '${TASK_PASS2}'
    AND run_id = '${RUN_ID_PASS2}'
),
merged_results AS (
  SELECT
    COALESCE(p2.item_qid, p1.item_qid) AS item_qid,
    COALESCE(p2.score, p1.score) AS expected_score,
    COALESCE(p2.confidence, p1.confidence) AS confidence,
    COALESCE(p2.is_regional, p1.is_regional) AS is_regional,
    CASE
      WHEN p2.item_qid IS NOT NULL THEN 'p2'
      ELSE 'p1'
    END AS source_pass
  FROM p1_results AS p1
  LEFT JOIN p2_results AS p2
    ON p1.item_qid = p2.item_qid
)
SELECT
  item_qid,
  expected_score,
  confidence,
  is_regional,
  source_pass
FROM merged_results
ORDER BY item_qid
;
