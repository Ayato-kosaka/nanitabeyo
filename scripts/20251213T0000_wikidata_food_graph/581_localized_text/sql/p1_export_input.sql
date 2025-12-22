-- #581 【設計】Pass1 用の入力データ抽出 SQL
-- dish_category_catalog から全対象アイテム × locale を生成

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
  {limit_clause}
),
-- #581 【設計】locale × item のクロス集計（ja-JP, en）
locales AS (
  SELECT 'ja-JP' AS locale UNION ALL
  SELECT 'en' AS locale
)
SELECT
  c.item_qid,
  l.locale,
  -- #581 【設計】locale に応じて適切なラベル・説明を選択
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
  c.aliases_json
FROM catalog_items c
CROSS JOIN locales l
ORDER BY c.item_qid, l.locale
