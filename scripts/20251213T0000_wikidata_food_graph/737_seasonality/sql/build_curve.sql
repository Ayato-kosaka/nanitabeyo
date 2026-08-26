-- #737 【SQL】raw の月次ページビュー → 12 か月の季節指数
--
-- index_value = その月の平均閲覧数 ÷ 全期間の平均閲覧数
--   1.0 = 平常月 / 2.0 = 平常月の 2 倍 / 0.5 = 平常月の半分
--
-- 【なぜ「年ごとの合計」ではなく「同じ月の平均」なのか】
-- 記事の人気は年単位で変動する（新規開店ブーム、テレビ放映）。
-- 同月を複数年で平均すると、単発の話題によるスパイクが薄まり、
-- 毎年繰り返す成分＝季節性だけが残る。実測でも対照群（焼き鳥）は 1.1 倍まで平坦になった。
--
-- 【needs_review】機械で採用してよいものは無い、という前提で組む。
-- 閾値を超えたものだけ人が見る。超えないものは season の行自体を作らない
-- （＝推薦側では COALESCE(...,1) で係数 1.0 になり、完全に無影響）。

CREATE OR REPLACE TABLE `${DATASET}.dish_category_seasonality_curve` AS
WITH raw_src AS (
  SELECT item_qid, wiki, article, ym, views
  FROM `${DATASET}.dish_category_seasonality_raw`
  WHERE run_id = '${RUN_ID}'
),
-- 【重要】未完成の月を捨てる
--
-- Wikimedia の直近月は集計が完了しておらず、**全記事いっせいに** 90% 以上落ちた値が返る。
-- 実測（2026-08-25 時点、2026-07 のデータ）:
--     おでん 2,612(6月) → 200(7月) / ラーメン 15,442 → 444 / 焼き鳥 2,753 → 80
-- 記事単位ではなく全体で起きるので「7 月は不人気」という偽の季節性を全カテゴリへ刻んでしまう。
--
-- そこで「その月の全記事合計」が中央値の ${MIN_MONTH_COMPLETENESS_RATIO} 未満の月は捨てる。
-- 本物の季節性は夏物と冬物が逆方向に動くため**合計はほとんど動かない**。
-- 実測の断絶は 97% 減なので、この閾値で取り違える余地は無い。
-- 固定の「N か月前まで」にしないのは、集計の遅れが常に同じ長さとは限らないため。
month_totals AS (
  SELECT ym, SUM(views) AS total FROM raw_src GROUP BY ym
),
month_median AS (
  SELECT APPROX_QUANTILES(total, 2)[OFFSET(1)] AS median_total FROM month_totals
),
usable_months AS (
  SELECT t.ym
  FROM month_totals t CROSS JOIN month_median m
  WHERE t.total >= ${MIN_MONTH_COMPLETENESS_RATIO} * m.median_total
),
src AS (
  SELECT r.* FROM raw_src r JOIN usable_months u USING (ym)
),
per_item AS (
  SELECT
    item_qid, wiki, ANY_VALUE(article) AS article,
    AVG(views) AS overall_mean,
    COUNT(*) AS months_observed
  FROM src
  GROUP BY item_qid, wiki
),
per_month AS (
  SELECT
    item_qid, wiki,
    CAST(SUBSTR(ym, 6, 2) AS INT64) AS month,
    AVG(views) AS month_mean
  FROM src
  GROUP BY item_qid, wiki, month
),
indexed_raw AS (
  SELECT
    m.item_qid, m.wiki, i.article, m.month,
    -- overall_mean = 0 は「全期間ずっと 0 PV」＝実質存在しない記事。
    -- 0 除算を避けつつ、後段の low_traffic で必ず弾かれる値にする
    SAFE_DIVIDE(m.month_mean, NULLIF(i.overall_mean, 0)) AS index_raw,
    i.overall_mean, i.months_observed
  FROM per_month m
  JOIN per_item i USING (item_qid, wiki)
),
-- 【重要】全記事に共通する季節成分を割り戻す
--
-- Wikipedia の閲覧数には「その料理の季節性」だけでなく「その月は全記事が沈む」という
-- 共通成分が乗っている。115 記事で実測した月ごとの中央値:
--     1月 1.06 / 2月 0.97 / 3月 0.98 / 4月 0.92 / 5月 1.05 / 6月 1.02
--     7月 0.95 / 8月 0.85 / 9月 1.01 / 10月 1.04 / 11月 1.03 / 12月 0.97
-- 8 月は全記事が一律に 15% 沈む（夏休みで PC からの閲覧が減る等）。
--
-- 割り戻さないと、**season の行を持つ料理だけが余計に 15% 沈む**（行が無い料理は
-- 係数 1.0 のままなので、共通成分の分だけ不公平な減点になる）。
-- 実際、割り戻すと対照群がきれいに 1.0 付近へ戻る:
--     焼き鳥 0.94→1.12 / ハンバーグ 0.80→0.95 / ラーメン 0.88→1.04 / 唐揚げ 0.82→0.97
-- 「平常（0.85〜1.15）」に入る記事も 48 件 → 79 件（115 中）へ増える。
--
-- 中央値を使うのは、極端な季節料理（かき氷 3.08 等）に引きずられないようにするため。
month_baseline AS (
  SELECT month, APPROX_QUANTILES(index_raw, 2)[OFFSET(1)] AS baseline
  FROM indexed_raw
  WHERE index_raw IS NOT NULL
  GROUP BY month
),
indexed AS (
  SELECT
    r.item_qid, r.wiki, r.article, r.month,
    r.index_raw,
    SAFE_DIVIDE(r.index_raw, NULLIF(b.baseline, 0)) AS index_value,
    r.overall_mean, r.months_observed
  FROM indexed_raw r
  JOIN month_baseline b USING (month)
),
stats AS (
  SELECT
    item_qid, wiki,
    MAX(index_value) AS peak_index,
    MIN(index_value) AS trough_index
  FROM indexed
  GROUP BY item_qid, wiki
)
SELECT
  x.item_qid,
  x.wiki,
  x.article,
  x.month,
  IFNULL(x.index_value, 1.0) AS index_value,
  IFNULL(x.index_raw, 1.0) AS index_raw,
  IFNULL(SAFE_DIVIDE(s.peak_index, NULLIF(s.trough_index, 0)), 1.0) AS amplitude,
  x.overall_mean AS monthly_pv_mean,
  x.months_observed,
  CASE
    WHEN x.months_observed < ${MIN_MONTHS_OBSERVED} THEN 'insufficient_history'
    WHEN x.overall_mean < ${MIN_MONTHLY_PV} THEN 'low_traffic'
    WHEN IFNULL(SAFE_DIVIDE(s.peak_index, NULLIF(s.trough_index, 0)), 1.0) < ${MIN_AMPLITUDE} THEN 'flat'
    ELSE 'ok'
  END AS quality_flag,
  (
    x.months_observed >= ${MIN_MONTHS_OBSERVED}
    AND x.overall_mean >= ${MIN_MONTHLY_PV}
    AND IFNULL(SAFE_DIVIDE(s.peak_index, NULLIF(s.trough_index, 0)), 1.0) >= ${MIN_AMPLITUDE}
  ) AS needs_review,
  '${RUN_ID}' AS run_id,
  CURRENT_TIMESTAMP() AS updated_at
FROM indexed x
JOIN stats s USING (item_qid, wiki)
