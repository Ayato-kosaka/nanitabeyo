-- #582 【設計】Pass2 用の入力データ抽出 SQL
-- Pass1 で confidence in ('medium', 'low') だったアイテムのみ再抽出

WITH catalog_items AS (
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
-- #582 【設計】Pass1 の結果から medium/low confidence のみ
pass1_retry AS (
  SELECT DISTINCT
    item_qid,
    locale
  FROM `{dataset}.wikidata_food_copy_generations`
  WHERE run_id = '{pass1_run_id}'
    AND confidence IN {trigger_confidence}
)
SELECT
  c.item_qid,
  p.locale,
  -- #582 【設計】locale に応じて適切なラベル・説明を選択
  CASE p.locale
    WHEN 'ja-JP' THEN COALESCE(c.label_ja, c.label_en, '')
    WHEN 'en' THEN COALESCE(c.label_en, '')
    ELSE ''
  END AS label,
  CASE p.locale
    WHEN 'ja-JP' THEN COALESCE(c.desc_ja, c.desc_en, '')
    WHEN 'en' THEN COALESCE(c.desc_en, '')
    ELSE ''
  END AS description,
  c.labels_json,
  c.aliases_json
FROM pass1_retry p
JOIN catalog_items c
  ON p.item_qid = c.item_qid
ORDER BY c.item_qid, p.locale
