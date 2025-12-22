-- #575 【SQL】入力データ抽出（JP gate allow 対象）
-- 
-- 【目的】
-- dish_category_catalog から JP gate allow の料理カードを抽出
-- 
-- 【出力】
-- - item_qid
-- - label_ja, desc_ja, aliases_top_ja（最小構成）

WITH jp_gate_allowed AS (
  SELECT DISTINCT
    item_qid
  FROM `${DATASET}.dish_category_features_catalog`
  WHERE feature_type = 'gate'
    AND feature_key = 'region:country:JP'
    AND score = 1
),
catalog_items AS (
  SELECT
    cat.item_qid,
    cat.labels_json,
    cat.descriptions_json,
    cat.aliases_json
  FROM `${DATASET}.dish_category_catalog` AS cat
  INNER JOIN jp_gate_allowed AS gate
    ON cat.item_qid = gate.item_qid
)
SELECT
  item_qid,
  -- 日本語情報抽出
  JSON_EXTRACT_SCALAR(labels_json, '$.ja') AS label_ja,
  -- desc_ja は長い場合は truncate（200文字程度）
  CASE
    WHEN LENGTH(JSON_EXTRACT_SCALAR(descriptions_json, '$.ja')) > 200
    THEN CONCAT(SUBSTR(JSON_EXTRACT_SCALAR(descriptions_json, '$.ja'), 1, 200), '...')
    ELSE JSON_EXTRACT_SCALAR(descriptions_json, '$.ja')
  END AS desc_ja,
  -- aliases_json から日本語エイリアスを最大5件抽出
  ARRAY_TO_STRING(
    ARRAY(
      SELECT alias
      FROM UNNEST(JSON_EXTRACT_ARRAY(aliases_json, '$.ja')) AS alias
      LIMIT 5
    ),
    ', '
  ) AS aliases_top_ja
FROM catalog_items
${MAX_ITEMS_LIMIT}
;
