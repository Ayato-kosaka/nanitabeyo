-- #572 【SQL】Pass2 入力データ抽出（Pass1 の medium/low confidence 対象）
-- 
-- 【目的】
-- Pass1 の結果から confidence が medium または low のアイテムを再抽出
-- 
-- 【出力】
-- Pass1 と同じ料理カード形式

WITH p1_results AS (
  SELECT
    item_qid,
    confidence
  FROM `${DATASET}.wikidata_food_llm_labels`
  WHERE task = '${TASK_PASS1}'
    AND run_id = '${RUN_ID_PASS1}'
    AND confidence IN UNNEST(${PASS2_TRIGGER_CONFIDENCE})
),
catalog_items AS (
  SELECT
    cat.item_qid,
    cat.labels_json,
    cat.descriptions_json,
    cat.aliases_json,
    cat.sitelinks_json,
    cat.roots,
    cat.origin_qids,
    cat.cuisine_qids,
    cat.tags
  FROM `${DATASET}.dish_category_catalog` AS cat
  INNER JOIN p1_results AS p1
    ON cat.item_qid = p1.item_qid
)
SELECT
  item_qid,
  JSON_EXTRACT_SCALAR(labels_json, '$.ja') AS label_ja,
  JSON_EXTRACT_SCALAR(descriptions_json, '$.ja') AS desc_ja,
  ARRAY_TO_STRING(
    ARRAY(
      SELECT alias
      FROM UNNEST(JSON_EXTRACT_ARRAY(aliases_json, '$.ja')) AS alias
      LIMIT 5
    ),
    ', '
  ) AS aliases_top_ja,
  ARRAY_TO_STRING(
    ARRAY(
      SELECT CONCAT(JSON_EXTRACT_SCALAR(root, '$.kind'), '(', JSON_EXTRACT_SCALAR(root, '$.min_depth'), ')')
      FROM UNNEST(JSON_EXTRACT_ARRAY(TO_JSON_STRING(roots))) AS root
      LIMIT 4
    ),
    ', '
  ) AS root_hints,
  ARRAY_TO_STRING(origin_qids, ', ') AS origin_country,
  ARRAY_TO_STRING(cuisine_qids, ', ') AS cuisine_family,
  IF(STRPOS(TO_JSON_STRING(sitelinks_json), 'ja.wikipedia.org') > 0, TRUE, FALSE) AS has_jawiki,
  -- ARRAY_TO_STRING(
  --   ARRAY(
  --     SELECT tag
  --     FROM UNNEST(tags) AS tag
  --     LIMIT 5
  --   ),
  --   ', '
  -- ) AS tags_top
FROM catalog_items
;
