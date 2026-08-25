-- ==============================================================================
-- 20260825T0000_create_dish_category_seasonality_tables.sql
-- ==============================================================================
-- 【目的】
-- #737 季節性（season feature）の生成パイプライン用テーブルを作る。
--
-- 【背景】
-- 夏におでん・鍋が上位固定される問題に対し、Wikipedia の月別閲覧数から
-- 料理ごとの季節曲線を作り、推薦のスコア補正へ流す。
-- 実測では おでん 12月/8月 = 4.7 倍、対照の焼き鳥 = 1.1 倍（平坦）で、
-- 季節性のある料理だけがはっきり分離できることを確認済み。
--
-- 【なぜ 3 本に分けるか】
-- - raw:    外部から取ってきた事実。再取得できるが、取得時点の値は保存する（append-only）
-- - curve:  raw から計算した派生値。計算式を変えたら run_id を変えて作り直す
-- - review: 人の判断。**機械が上書きしてはいけない**ので独立させる（append-only）
--
-- curve を機械的にそのまま採用してはいけないことは実測で分かっている。
-- 「カフェ」「和食」のような抽象カテゴリや、sitelink が別記事を指していた「日本の餃子」で
-- 偽の季節性が出た。review を通ったものだけが dish_category_features_catalog へ行く。
--
-- 【ロールバック】
-- DROP TABLE IF EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_review`;
-- DROP TABLE IF EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_curve`;
-- DROP TABLE IF EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_raw`;
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. raw: Wikimedia Analytics API から取得した月次ページビュー
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_raw` (
  item_qid   STRING NOT NULL OPTIONS(description="dish_category_catalog.item_qid"),
  wiki       STRING NOT NULL OPTIONS(description="言語版。例: ja.wikipedia"),
  article    STRING NOT NULL OPTIONS(description="記事タイトル（URL デコード済み）"),
  ym         STRING NOT NULL OPTIONS(description="対象月 YYYY-MM"),
  views      INT64  NOT NULL OPTIONS(description="その月の閲覧数（agent=user）"),
  source     STRING NOT NULL OPTIONS(description="取得元。'wikimedia_pageviews'"),
  run_id     STRING NOT NULL OPTIONS(description="取得実行の識別子"),
  fetched_at TIMESTAMP NOT NULL
)
OPTIONS(
  description="#737 料理カテゴリの月次ページビュー（append-only）。Wikimedia のデータは CC0。"
);

-- ------------------------------------------------------------------------------
-- 2. curve: raw から計算した 12 か月の季節指数
-- ------------------------------------------------------------------------------
-- index_value = その月の平均閲覧数 ÷ 全期間の平均閲覧数
--   1.0 = 平常月 / 2.0 = 平常月の 2 倍
-- amplitude / monthly_pv_mean / quality_flag は **カテゴリ単位の値**を 12 行に繰り返し持つ。
-- 正規化すると join が増えるだけで、134 件 × 12 か月しかないため冗長さの害が無い。
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_curve` (
  item_qid        STRING NOT NULL,
  wiki            STRING NOT NULL,
  article         STRING NOT NULL,
  month           INT64  NOT NULL OPTIONS(description="1〜12"),
  index_value     FLOAT64 NOT NULL OPTIONS(description="月指数。1.0 = 平常月"),
  amplitude       FLOAT64 NOT NULL OPTIONS(description="カテゴリ単位。ピーク月指数 ÷ 谷月指数"),
  monthly_pv_mean FLOAT64 NOT NULL OPTIONS(description="カテゴリ単位。月平均閲覧数"),
  months_observed INT64  NOT NULL OPTIONS(description="カテゴリ単位。集計に使った月数"),
  quality_flag    STRING NOT NULL OPTIONS(description="'ok' | 'low_traffic' | 'flat' | 'insufficient_history'"),
  needs_review    BOOL   NOT NULL OPTIONS(description="人の確認が要るか（振幅と PV の閾値で機械判定）"),
  run_id          STRING NOT NULL,
  updated_at      TIMESTAMP NOT NULL
)
OPTIONS(
  description="#737 月次ページビューから計算した季節指数。run_id 単位で作り直せる派生値。"
);

-- ------------------------------------------------------------------------------
-- 3. review: 人（＋Claude Code の下書き）の判断
-- ------------------------------------------------------------------------------
-- 【重要】append-only。同じ (item_qid, run_id) に複数行がありうるので、
-- 参照側は created_at の最新を採用する。判断を消さずに履歴として残すため。
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `food-scroll.wikidata_food_graph.dish_category_seasonality_review` (
  item_qid   STRING NOT NULL,
  run_id     STRING NOT NULL OPTIONS(description="レビュー対象の curve の run_id"),
  decision   STRING NOT NULL OPTIONS(description="'approve' | 'reject'"),
  reason     STRING NOT NULL OPTIONS(description="判断の根拠。空文字を許さない"),
  reviewer   STRING NOT NULL OPTIONS(description="'claude-code' | 'owner' 等"),
  created_at TIMESTAMP NOT NULL
)
OPTIONS(
  description="#737 季節曲線を採用してよいかの判断（append-only）。機械が上書きしない。"
);
