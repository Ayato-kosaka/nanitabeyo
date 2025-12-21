-- #572 【SQL】Pass1 入力データ抽出（JP gate allow 対象）
-- 
-- 【目的】
-- dish_category_catalog から JP gate allow の料理カードを抽出
-- 
-- 【出力】
-- - item_qid
-- - label_ja, desc_ja, aliases_top_ja
-- - root_hints (roots から抽出)
-- - origin_country (origin_qids から国名マッピング)
-- - cuisine_family (cuisine_qids から上位カテゴリ名マッピング)
-- - has_jawiki (オプション)
-- - tags_top (オプション)

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
    cat.aliases_json,
    cat.sitelinks_json,
    cat.roots,
    cat.origin_qids,
    cat.cuisine_qids,
    cat.tags
  FROM `${DATASET}.dish_category_catalog` AS cat
  INNER JOIN jp_gate_allowed AS gate
    ON cat.item_qid = gate.item_qid
)
SELECT
  item_qid,
  -- 日本語情報抽出
  JSON_EXTRACT_SCALAR(labels_json, '$.ja') AS label_ja,
  JSON_EXTRACT_SCALAR(descriptions_json, '$.ja') AS desc_ja,
  -- aliases_json から日本語エイリアスを最大5件抽出
  ARRAY_TO_STRING(
    ARRAY(
      SELECT alias
      FROM UNNEST(JSON_EXTRACT_ARRAY(aliases_json, '$.ja')) AS alias
      LIMIT 5
    ),
    ', '
  ) AS aliases_top_ja,
  -- roots から kind と min_depth を抽出（最大4件）
  ARRAY_TO_STRING(
    ARRAY(
      SELECT CONCAT(JSON_EXTRACT_SCALAR(root, '$.kind'), '(', JSON_EXTRACT_SCALAR(root, '$.min_depth'), ')')
      FROM UNNEST(JSON_EXTRACT_ARRAY(TO_JSON_STRING(roots))) AS root
      LIMIT 4
    ),
    ', '
  ) AS root_hints,
  -- origin_qids から国名を抽出（簡易版）
  ARRAY_TO_STRING(origin_qids, ', ') AS origin_country,
  -- cuisine_qids から料理系統を抽出（簡易版）
  ARRAY_TO_STRING(cuisine_qids, ', ') AS cuisine_family,
  -- オプション: jawiki の有無
  IF(STRPOS(TO_JSON_STRING(sitelinks_json), 'ja.wikipedia.org') > 0, TRUE, FALSE) AS has_jawiki,
  -- オプション: tags から上位5件を抽出
  ARRAY_TO_STRING(
    ARRAY(
      SELECT tag
      FROM UNNEST(tags) AS tag
      LIMIT 5
    ),
    ', '
  ) AS tags_top
FROM catalog_items
${MAX_ITEMS_LIMIT}
;
