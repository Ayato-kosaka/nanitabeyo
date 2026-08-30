-- =============================================================================
-- SNS(Instagram) seed → 全国 dish_media 本投入パイプライン の BigQuery 基盤（#1273）
-- =============================================================================
--
-- 【Dataset の位置付け】
-- `${DATASET}` は `food-scroll.restaurant_recommendation` を想定する（店提案基盤と同居）。
-- `restaurant_catalog`（市区町村 join 用）と `restaurant_pipeline_runs` /
-- `restaurant_source_manifests`（run/manifest ログ）を再利用するため、専用データセットを
-- 新設しない。旧 PoC の `food-scroll.sns_seed.*` は本 migration の対象外（別途 dataset ごと破棄）。
--
-- 【設計の芯（#1273 ゼロベース清書）】
-- - resolve が単一頭脳。パイプラインは URL を渡すだけ（店舗照合・カテゴリ照合・住所
--   ジオコーディングは API 側。ここに写経しない）。
-- - 収集(raw)は「飲食の投稿URLを見つける」だけ。**caption は持たない**（resolve が URL から取り直す）。
-- - **pg の UUID を一切持たない**。店は google_place_id（環境非依存・restaurants.google_place_id UNIQUE）、
--   料理は Wikidata QID（dish_categories.id）で指す。dev/public を跨げる。
-- - provider 共通列（Instagram を今、TikTok/YouTube は provider 値と収集器追加だけで拡張）。
--
-- 【命名規則】（既存 20260812T0000 に準拠）
-- - *_raw: 収集の観測値。run_id 単位の追記専用。
-- - *_resolved: resolve 適用結果（1:1 派生）。
-- - *_catalog: 現在採用する生成物。番号付きスクリプトが再生成する。
-- - BigQuery は PK/FK を強制しないため、自然キーはコメントで示し実検証は 7_x / sync 側で行う。
--
-- 【partition 方針】
-- 取り込み日で PARTITION（ライフサイクル/コスト）するが require_partition_filter は付けない。
-- 本パイプラインは中規模（〜数十万行）で、5_1/7_1/9_1 の join を単純に保つことを優先する
-- （1M+ 行を持つ restaurant *_raw は require_partition_filter=TRUE だが、それとは規模が違う）。
-- 同一 run_id の途中再実行は delete_run_rows（run_id 単位 DELETE）で冪等化する。
--
-- 【作り直し】このファイルは冒頭で既存 sns_* を DROP してから作り直す（スキーマ揺れを断つ）。
-- =============================================================================

DROP TABLE IF EXISTS `${DATASET}.sns_source_account`;
DROP TABLE IF EXISTS `${DATASET}.sns_post_raw`;
DROP TABLE IF EXISTS `${DATASET}.sns_post_parsed`;      -- 旧設計（parse ステップ）を廃止
DROP TABLE IF EXISTS `${DATASET}.sns_post_resolved`;
DROP TABLE IF EXISTS `${DATASET}.sns_coverage`;
DROP TABLE IF EXISTS `${DATASET}.sns_dish_media_catalog`;

-- -----------------------------------------------------------------------------
-- ① 収集元アカウント（ルート1: 店IGアカウント / ルート2: インフルエンサー）
-- -----------------------------------------------------------------------------
CREATE TABLE `${DATASET}.sns_source_account` (
  account_id              STRING NOT NULL,  -- provider ネイティブ ID か handle。自然キー (provider, account_id)
  provider                STRING NOT NULL,  -- 'instagram'（将来 'tiktok' / 'youtube'）
  handle                  STRING,           -- 表示用ハンドル
  account_type            STRING,           -- 'store_branch' / 'store_brand' / 'influencer'（#1273 §23）
  discovery_method        STRING,           -- 'serper_account_discovery' / 'open_data_socials' / 'influencer_list'
  discovery_seed_place_id STRING,           -- ルート1: この店アカウントが属する店の google_place_id（pg UUID ではない）
  followers               INT64,
  media_count             INT64,
  discovered_at           TIMESTAMP NOT NULL,
  run_id                  STRING NOT NULL
)
PARTITION BY DATE(discovered_at)
CLUSTER BY provider, account_type
OPTIONS (description = '収集元アカウント。pg UUID を持たない。店は google_place_id で指す。#1273');

-- -----------------------------------------------------------------------------
-- ② 投稿URLプール（収集の唯一の出力。caption を持たない）
-- -----------------------------------------------------------------------------
CREATE TABLE `${DATASET}.sns_post_raw` (
  post_id                 STRING NOT NULL,  -- provider ネイティブ投稿 ID。自然キー (provider, post_id)
  provider                STRING NOT NULL,  -- 'instagram'
  canonical_url           STRING NOT NULL,  -- resolve へ渡す唯一の入力
  account_id              STRING,           -- NULL=ルート3（検索由来の単体投稿）。非NULL=ルート1/2
  discovery_route         STRING NOT NULL,  -- 'store_account' / 'influencer' / 'hashtag_search'
  discovery_method        STRING,           -- 'ig_business_discovery' / 'serper_post_search'
  discovery_query         STRING,           -- 検索文字列（監査用）
  discovery_seed_place_id STRING,           -- ルート1: 対象店の google_place_id（resolve の lat/lng 元）
  discovery_area_lat      FLOAT64,          -- ルート3: 検索エリア中心（resolve へ渡す）
  discovery_area_lng      FLOAT64,
  discovery_category_id   STRING,           -- ルート3: 検索に使った料理 QID（source 分解用。分類の正解ではない）
  fetched_at              TIMESTAMP NOT NULL,
  run_id                  STRING NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY provider, discovery_route
OPTIONS (description = '投稿URLプール（追記のみ）。caption 列は持たない（resolve が URL から取り直す）。#1273');

-- -----------------------------------------------------------------------------
-- ③ resolve 適用結果（旧 parse ステップを置換。post_raw と 1:1）
-- -----------------------------------------------------------------------------
CREATE TABLE `${DATASET}.sns_post_resolved` (
  post_id               STRING NOT NULL,  -- (provider, post_id) で raw と 1:1
  provider              STRING NOT NULL,
  status                STRING NOT NULL,  -- matched / skipped_no_store / skipped_no_category / skipped_unavailable / skipped_unsupported
  google_place_id       STRING,           -- matched のときだけ非 NULL（pg UUID は持たない）
  dish_category_id      STRING,           -- matched のときだけ非 NULL（Wikidata QID）
  restaurant_confidence FLOAT64,          -- resolve prefill 由来
  category_confidence   FLOAT64,
  resolve_reason        STRING,           -- resolve の reason（トリアージ用）
  resolve_version       STRING,           -- resolve のデプロイ識別（再処理管理）
  resolved_at           TIMESTAMP NOT NULL,
  run_id                STRING NOT NULL
)
PARTITION BY DATE(resolved_at)
CLUSTER BY status, provider
OPTIONS (description = 'resolve 適用結果。address/store/dish や独自照合ロジックは持たない（全て resolve 内）。#1273');

-- -----------------------------------------------------------------------------
-- ④ 被覆（フェーズ A 成果物）
-- -----------------------------------------------------------------------------
CREATE TABLE `${DATASET}.sns_coverage` (
  dish_category_id     STRING NOT NULL,  -- Wikidata QID
  region               STRING,           -- 都道府県
  city                 STRING,           -- 市区町村
  source_route         STRING NOT NULL,  -- 'store_account' / 'influencer' / 'hashtag_search' / 'all'
  distinct_store_count INT64 NOT NULL,   -- 異なり google_place_id 数
  post_count           INT64 NOT NULL,
  computed_at          TIMESTAMP NOT NULL,
  run_id               STRING NOT NULL
)
CLUSTER BY dish_category_id, region
OPTIONS (description = 'カテゴリ×市区町村の異なり店の充足。0件の組合せも行として残す。#1273');

-- -----------------------------------------------------------------------------
-- ⑤ 配信 catalog（フェーズ B。matched の ready 部分集合。row_hash upsert 用）
-- -----------------------------------------------------------------------------
CREATE TABLE `${DATASET}.sns_dish_media_catalog` (
  provider            STRING NOT NULL,
  external_content_id STRING NOT NULL,  -- = post_id。自然キー (provider, external_content_id, dish_category_id)
  canonical_url       STRING NOT NULL,
  google_place_id     STRING NOT NULL,
  dish_category_id    STRING NOT NULL,  -- Wikidata QID
  thumbnail_url       STRING,           -- resolve が返せた時のみ。無ければ NULL
  row_hash            STRING NOT NULL,  -- stable_record_hash（pg への差分 upsert 用）
  built_at            TIMESTAMP NOT NULL,
  run_id              STRING NOT NULL
)
CLUSTER BY google_place_id, dish_category_id
OPTIONS (description = 'matched の ready 部分集合。9_2 が google_place_id→restaurants.id へ翻訳して pg へ upsert。#1273');

-- run/manifest ログは新設せず restaurant_pipeline_runs / restaurant_source_manifests を再利用する。
