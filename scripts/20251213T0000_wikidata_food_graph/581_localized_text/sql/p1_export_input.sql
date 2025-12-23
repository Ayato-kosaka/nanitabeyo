-- #581 【設計】Pass1 用の入力データ抽出 SQL
-- dish_category_catalog から全対象アイテム × locale を生成

WITH gate_allowed AS (
  SELECT
    gate.item_qid,
    MAX(
      COALESCE(market_salience.score, 0)
      * COALESCE(dine_out_orderability.score, 0)
    ) AS priority_score
  FROM `{dataset}.dish_category_features_catalog` gate
  LEFT JOIN `{dataset}.dish_category_features_catalog` market_salience
    ON market_salience.item_qid = gate.item_qid
   AND market_salience.feature_type = 'market_salience'
   AND market_salience.feature_key = 'region:country:JP'
  LEFT JOIN `{dataset}.dish_category_features_catalog` dine_out_orderability
    ON dine_out_orderability.item_qid = gate.item_qid
   AND dine_out_orderability.feature_type = 'dine_out_orderability'
   AND dine_out_orderability.feature_key = 'global'
  WHERE gate.feature_type = 'gate'
    AND gate.score = 1
  GROUP BY gate.item_qid
),

catalog_items AS (
  SELECT
    item_qid,
    label_ja,
    label_en,
    desc_ja,
    desc_en,
    labels_json,
    aliases_json
  FROM `{dataset}.dish_category_catalog`
),
-- #581 【設計】locale × item のクロス集計（ja-JP, en）
locales AS (
  SELECT 'ja-JP' AS locale UNION ALL
  SELECT 'en' AS locale
)

SELECT
  c.item_qid,
  l.locale,
  CASE l.locale
    WHEN 'ja-JP' THEN COALESCE(c.label_ja, c.label_en, '')
    WHEN 'en' THEN COALESCE(c.label_en, '')
    ELSE ''
  END AS label,
  CASE l.locale
    WHEN 'ja-JP' THEN COALESCE(c.desc_ja, c.desc_en, '')
    WHEN 'en' THEN COALESCE(c.desc_en, '')
    ELSE ''
  END AS description,
  c.labels_json,
  c.aliases_json,
  g.priority_score
FROM catalog_items c
JOIN gate_allowed g
  ON c.item_qid = g.item_qid
CROSS JOIN locales l
ORDER BY g.priority_score DESC, c.item_qid, l.locale
{limit_clause} OFFSET 0;

