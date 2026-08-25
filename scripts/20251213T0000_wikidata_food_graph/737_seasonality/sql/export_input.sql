-- #737 【SQL】season の対象記事リストを作る
--
-- 【対象】gate を通っている料理カテゴリだけ（＝推薦の候補になりうるもの）。
-- カタログ全体は 14,597 件あるが、gate 通過は 134 件しかないので、
-- ここで絞らないと無駄に 1 万件以上 API を叩くことになる。
--
-- 【sitelinks_json】サイト URL をキーにした辞書で、値がフル URL。
-- 記事タイトルの取り出しは Python 側（lib/pageviews.parse_wiki_article）でやる。
-- BigQuery の JSON 関数はキーに `https://...` を含むパスを扱えないため。

SELECT
  c.item_qid,
  c.label_ja,
  c.label_en,
  c.sitelinks_json
FROM `${DATASET}.dish_category_catalog` c
WHERE c.item_qid IN (
  SELECT DISTINCT dish_category_id_or_item_qid
  FROM (
    SELECT item_qid AS dish_category_id_or_item_qid
    FROM `${DATASET}.dish_category_features_catalog`
    WHERE feature_type = 'gate' AND score > 0
  )
)
ORDER BY c.item_qid
