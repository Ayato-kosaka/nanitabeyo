-- #581 【SQL】入力データ抽出（gate whitelist 通過済み dish_category）
-- 
-- 【目的】
-- dish_category_catalog から gate whitelist 通過済みの料理カードを抽出
-- 
-- 【抽出条件】
-- dish_category_features_catalog で以下を満たすもの：
--   feature_type = 'gate'
--   feature_key IN (region whitelist: 'region:country:JP' など)
--   score = 1
-- 
-- 【出力】
-- - item_qid
-- - label_ja, desc_ja, aliases_top_ja（最小構成）


WITH gate_allowed AS (
  SELECT
    gate.item_qid,
    MAX(
      COALESCE(market_salience.score, 0)
      * COALESCE(dine_out_orderability.score, 0)
    ) AS priority_score
  FROM `${DATASET}.dish_category_features_catalog` gate
  LEFT JOIN `${DATASET}.dish_category_features_catalog` market_salience
    ON market_salience.item_qid = gate.item_qid
   AND market_salience.feature_type = 'market_salience'
   AND market_salience.feature_key = 'region:country:JP'
  LEFT JOIN `${DATASET}.dish_category_features_catalog` dine_out_orderability
    ON dine_out_orderability.item_qid = gate.item_qid
   AND dine_out_orderability.feature_type = 'dine_out_orderability'
   AND dine_out_orderability.feature_key = 'global'
  WHERE gate.feature_type = 'gate'
    AND gate.score = 1
  GROUP BY gate.item_qid
),
catalog_items AS (
  SELECT
    cat.item_qid,
    cat.labels_json,
    cat.descriptions_json,
    cat.aliases_json,
    gate.priority_score
  FROM `${DATASET}.dish_category_catalog` AS cat
  INNER JOIN gate_allowed AS gate
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
ORDER BY priority_score DESC, item_qid
${MAX_ITEMS_LIMIT}
;
