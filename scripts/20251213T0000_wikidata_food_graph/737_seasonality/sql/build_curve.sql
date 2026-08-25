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
indexed AS (
  SELECT
    m.item_qid, m.wiki, i.article, m.month,
    -- overall_mean = 0 は「5年間ずっと 0 PV」＝実質存在しない記事。
    -- 0 除算を避けつつ、後段の low_traffic で必ず弾かれる値にする
    SAFE_DIVIDE(m.month_mean, NULLIF(i.overall_mean, 0)) AS index_value,
    i.overall_mean, i.months_observed
  FROM per_month m
  JOIN per_item i USING (item_qid, wiki)
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
