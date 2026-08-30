-- #1273 フェーズA: SNS seed パイプラインの BigQuery テーブル定義
-- dataset: food-scroll.sns_seed（分析ステージ。pg には一切書かない）
-- 責務: 発見・測定・確定の工場。pg UUID は持たず、環境非依存の google_place_id で店を指す。
-- 設計合意ログ: Issue #1273（resolve 単一頭脳 / dev-public 非依存キー / catalog=parsed の ready 部分集合）

CREATE SCHEMA IF NOT EXISTS `food-scroll.sns_seed` OPTIONS(location='US');

-- ① 収集元アカウント一覧。account_type=influencer(柱2)/store(柱1)
CREATE TABLE IF NOT EXISTS `food-scroll.sns_seed.sns_source_account` (
  account_id STRING, handle STRING, provider STRING,
  account_type STRING, source STRING,
  media_count INT64, followers INT64,
  discovered_at TIMESTAMP, run_id STRING
) OPTIONS(description='収集元アカウント一覧。pg UUIDは持たない。#1273');

-- ② 投稿プール（追記のみ）。account_id NULL = 検索由来の単体投稿。自然キー post_id。
--    provider 共通列。IG 固有は raw_payload(JSON) に逃がす。
CREATE TABLE IF NOT EXISTS `food-scroll.sns_seed.sns_post_raw` (
  post_id STRING, provider STRING, shortcode STRING, permalink STRING,
  account_id STRING, caption STRING, posted_at TIMESTAMP,
  discovery_source STRING, raw_payload JSON,
  fetched_at TIMESTAMP, run_id STRING
) PARTITION BY DATE(fetched_at) CLUSTER BY provider, account_id
OPTIONS(description='投稿プール（追記のみ）。account_id NULL=検索由来。#1273');

-- ③ 解析+resolve結果（post_id と 1:1）。matched 時のみ google_place_id/dish_category_id。
--    place_id は #1276 の無料SKU逆引き、category は resolve と同じ辞書。resolve_version で再処理を管理。
CREATE TABLE IF NOT EXISTS `food-scroll.sns_seed.sns_post_parsed` (
  post_id STRING, address_raw STRING, store_name STRING, dish_text STRING,
  google_place_id STRING, dish_category_id STRING,
  match_confidence FLOAT64, status STRING,
  resolve_version STRING, parsed_at TIMESTAMP, run_id STRING
) OPTIONS(description='解析+resolve結果。status=matched/skipped_no_store/skipped_ambiguous/not_food。pg UUIDは持たない。#1273');

-- ④ 被覆（成果物）。異なり google_place_id 数をカテゴリ×市区町村で。
CREATE TABLE IF NOT EXISTS `food-scroll.sns_seed.sns_coverage` (
  dish_category_id STRING, region STRING, city STRING,
  distinct_store_count INT64, post_count INT64,
  source_route STRING, run_id STRING, computed_at TIMESTAMP
) OPTIONS(description='被覆。カテゴリ×市区町村の異なり店。#1273');
