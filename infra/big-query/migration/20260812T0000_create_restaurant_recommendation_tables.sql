-- =============================================================================
-- 店提案用 BigQuery 基盤
-- =============================================================================
--
-- 【Dataset の位置付け】
-- `${DATASET}` は `food-scroll.restaurant_recommendation` を想定する。
-- Overture / IFAS / OSM / 既存 PostgreSQL を原票として保持し、Google Place ID
-- が確定した店舗と利用可能な dish_media だけを PostgreSQL に公開するための
-- Source of Truth である。
--
-- 【命名規則】
-- - *_raw: 外部または既存DBから取得した観測値。run_id 単位の追記専用。
-- - *_attempts / *_logs: 再実行しても消さない監査ログ。
-- - *_catalog: 現在採用する生成物。番号付きスクリプトが再生成する。
--
-- BigQuery の PRIMARY KEY / FOREIGN KEY は強制されないため、制約を宣言する
-- 代わりに 8_1_validate_catalogs.py で実データを検証する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 実行・取得元・品質監査
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_pipeline_runs` (
  run_id            STRING NOT NULL,
  step_name         STRING NOT NULL,
  status            STRING NOT NULL,
  code_version      STRING,
  parameters_json   STRING,
  row_count         INT64,
  error_message     STRING,
  started_at        TIMESTAMP NOT NULL,
  finished_at       TIMESTAMP
)
PARTITION BY DATE(started_at)
CLUSTER BY run_id, step_name
OPTIONS (
  require_partition_filter = TRUE,
  description = '番号付き手動スクリプトの実行履歴。run_id と step_name で追跡する。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_source_manifests` (
  run_id            STRING NOT NULL,
  source            STRING NOT NULL,
  snapshot_date     DATE NOT NULL,
  source_release    STRING,
  source_uri        STRING,
  local_file_name   STRING,
  sha256            STRING,
  license_id        STRING,
  terms_version     STRING,
  attribution_text  STRING,
  row_count         INT64,
  loaded_at         TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY source, run_id
OPTIONS (
  require_partition_filter = TRUE,
  description = '取得元、snapshot、checksum、license を再現可能にするmanifest。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_quality_results` (
  validation_id      STRING NOT NULL,
  run_id             STRING NOT NULL,
  check_name         STRING NOT NULL,
  severity           STRING NOT NULL,
  passed             BOOL NOT NULL,
  observed_value     FLOAT64,
  threshold_value    FLOAT64,
  details_json       STRING,
  checked_at         TIMESTAMP NOT NULL
)
PARTITION BY DATE(checked_at)
CLUSTER BY run_id, severity, check_name
OPTIONS (
  require_partition_filter = TRUE,
  description = 'PostgreSQL publish 前の品質ゲート結果。fail が1件でもあれば同期を止める。'
);

-- 初期版を適用済みのDatasetにもvalidation単位を追加する。既存行はNULLのままでも、
-- 9_* はvalidation_id付きの新しい8_1結果だけを採用する。
ALTER TABLE `${DATASET}.restaurant_quality_results`
  ADD COLUMN IF NOT EXISTS validation_id STRING;

-- -----------------------------------------------------------------------------
-- 1. ソース別 raw
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_existing_pg_raw` (
  run_id                   STRING NOT NULL,
  snapshot_date            DATE NOT NULL,
  source_record_id         STRING NOT NULL,
  google_place_id          STRING NOT NULL,
  name                     STRING NOT NULL,
  name_language_code       STRING,
  latitude                 FLOAT64 NOT NULL,
  longitude                FLOAT64 NOT NULL,
  image_url                STRING,
  image_path               STRING,
  address_components_json  STRING,
  plus_code_json           STRING,
  created_at               TIMESTAMP,
  record_hash              STRING NOT NULL,
  ingested_at              TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY google_place_id, source_record_id
OPTIONS (
  require_partition_filter = TRUE,
  description = '既存需要を欠損させないための PostgreSQL restaurants snapshot。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_overture_raw` (
  run_id             STRING NOT NULL,
  snapshot_date      DATE NOT NULL,
  source_release     STRING NOT NULL,
  source_record_id   STRING NOT NULL,
  name               STRING,
  address            STRING,
  -- #843 Overture の addresses[1].country（ISO 3166-1 alpha-2）。
  -- 日本の絞り込みはこの列で行う。座標の矩形は韓国・沿海地方を含むので国にならない。
  address_country    STRING,
  latitude           FLOAT64,
  longitude          FLOAT64,
  primary_category   STRING,
  categories         ARRAY<STRING>,
  operating_status   STRING,
  confidence         FLOAT64,
  sources_json       STRING NOT NULL,
  phones             ARRAY<STRING>,
  websites           ARRAY<STRING>,
  socials            ARRAY<STRING>,
  raw_payload_json   STRING,
  record_hash        STRING NOT NULL,
  ingested_at        TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY source_record_id, primary_category
OPTIONS (
  require_partition_filter = TRUE,
  description = 'Overture Places の日本 food_and_drink snapshot。'
);

-- Overtureはfeatureごとにsource/licenseが異なるため、Dataset作成済み環境でも
-- sources列を後付けできるようにする。
ALTER TABLE `${DATASET}.restaurant_overture_raw`
  ADD COLUMN IF NOT EXISTS sources_json STRING;

-- #843 既存 Dataset にも国の列を後付けする。
ALTER TABLE `${DATASET}.restaurant_overture_raw`
  ADD COLUMN IF NOT EXISTS address_country STRING;

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_ifas_raw` (
  run_id             STRING NOT NULL,
  snapshot_date      DATE NOT NULL,
  source_release     STRING,
  source_record_id   STRING NOT NULL,
  jurisdiction_code  STRING,
  name               STRING,
  address            STRING,
  latitude           FLOAT64,
  longitude          FLOAT64,
  phone              STRING,
  business_type      STRING,
  business_format    STRING,
  permit_expires_on  DATE,
  closed_on          DATE,
  is_active          BOOL NOT NULL,
  raw_payload_json   STRING,
  record_hash        STRING NOT NULL,
  ingested_at        TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY jurisdiction_code, source_record_id
OPTIONS (
  require_partition_filter = TRUE,
  description = 'IFAS の飲食店営業・喫茶店営業レコード。許可は店舗IDではなく根拠として扱う。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_osm_raw` (
  run_id             STRING NOT NULL,
  snapshot_date      DATE NOT NULL,
  source_release     STRING,
  source_record_id   STRING NOT NULL,
  osm_type           STRING NOT NULL,
  osm_id             INT64 NOT NULL,
  name               STRING,
  address            STRING,
  latitude           FLOAT64,
  longitude          FLOAT64,
  phone              STRING,
  website            STRING,
  social_urls        ARRAY<STRING>,
  amenity            STRING,
  cuisine            ARRAY<STRING>,
  opening_hours      STRING,
  tags_json          STRING,
  record_hash        STRING NOT NULL,
  ingested_at        TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY amenity, source_record_id
OPTIONS (
  require_partition_filter = TRUE,
  description = 'OSM PBF から抽出したコア飲食業態。ODbLの由来を失わない。'
);

-- 4つ目のソース: 自治体の食品営業許可台帳。
-- IFAS は 2021年6月の食品衛生法改正以降の申請しか持たないため、改正前に許可を
-- 取った施設が丸ごと欠ける。実測で、Google の店に届かない分の中心は雑居ビル
-- 上階のスナック・バーで、許可台帳の住所には階数が入るのでそこを指せる。
-- ③（Google 側から見た到達率）は台帳のある自治体で 66.5% → 78.9% になった。
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_food_permit_raw` (
  run_id             STRING NOT NULL,
  snapshot_date      DATE NOT NULL,
  source_release     STRING,
  source_record_id   STRING NOT NULL,
  jurisdiction       STRING,
  name               STRING,
  address            STRING,
  business_type      STRING,
  latitude           FLOAT64,
  longitude          FLOAT64,
  -- 'source'（台帳に座標があった） / 'geocoded:full' 等（国土地理院で解決した粒度）。
  -- 粗い座標を番地レベルと誤認しないために残す。
  coordinate_source  STRING,
  is_active          BOOL NOT NULL,
  raw_payload_json   STRING,
  record_hash        STRING NOT NULL,
  ingested_at        TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY run_id, jurisdiction
OPTIONS (
  require_partition_filter = TRUE,
  description = '自治体が公開する食品営業許可施設一覧。IFAS に載らない改正前の許可を補う。'
);

-- -----------------------------------------------------------------------------
-- 2. 共通形式とソース横断 seed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_source_records` (
  run_id                   STRING NOT NULL,
  source                   STRING NOT NULL,
  source_record_id         STRING NOT NULL,
  source_release           STRING,
  name                     STRING NOT NULL,
  name_language_code       STRING,
  normalized_name          STRING NOT NULL,
  normalized_name_l1       STRING NOT NULL,
  address                  STRING,
  normalized_address       STRING,
  -- #843 取り込み時点で分かる国（ISO 3166-1 alpha-2）。座標から推測しない。
  country_code             STRING,
  latitude                 FLOAT64 NOT NULL,
  longitude                FLOAT64 NOT NULL,
  location                 GEOGRAPHY NOT NULL,
  s2_cell_id               INT64 NOT NULL,
  phone                    STRING,
  website                  STRING,
  social_urls              ARRAY<STRING>,
  source_categories        ARRAY<STRING>,
  operating_status         STRING,
  source_confidence        FLOAT64,
  existing_restaurant_id   STRING,
  google_place_id          STRING,
  image_url                STRING,
  image_path               STRING,
  address_components_json  STRING,
  plus_code_json           STRING,
  raw_payload_json         STRING,
  record_hash              STRING NOT NULL,
  built_at                 TIMESTAMP NOT NULL
)
CLUSTER BY source, s2_cell_id, normalized_name
OPTIONS (
  description = 'ソース1レコードにつき1行の共通形式。ここでは同一店舗へ統合しない。'
);

ALTER TABLE `${DATASET}.restaurant_source_records`
  ADD COLUMN IF NOT EXISTS name_language_code STRING;

ALTER TABLE `${DATASET}.restaurant_source_records`
  ADD COLUMN IF NOT EXISTS country_code STRING;

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_seed_catalog` (
  run_id                    STRING NOT NULL,
  seed_id                   STRING NOT NULL,
  canonical_name            STRING NOT NULL,
  normalized_name           STRING NOT NULL,
  canonical_address         STRING,
  normalized_address        STRING,
  -- #843 source records の country_code を、canonical 列と同じ優先順位で畳んだ値。
  country_code              STRING,
  latitude                  FLOAT64 NOT NULL,
  longitude                 FLOAT64 NOT NULL,
  location                  GEOGRAPHY NOT NULL,
  s2_cell_id                INT64 NOT NULL,
  phone                     STRING,
  website                   STRING,
  social_urls               ARRAY<STRING>,
  source_names              ARRAY<STRING>,
  source_record_count       INT64 NOT NULL,
  seed_origin               STRING NOT NULL,
  entity_resolution_method  STRING NOT NULL,
  entity_resolution_score   FLOAT64,
  existing_restaurant_id    STRING,
  existing_google_place_id  STRING,
  image_url                 STRING,
  image_path                STRING,
  address_components_json   STRING,
  plus_code_json            STRING,
  conflict_reason           STRING,
  built_at                  TIMESTAMP NOT NULL
)
CLUSTER BY s2_cell_id, seed_origin, normalized_name
OPTIONS (
  description = 'ソース横断で名寄せした実店舗候補。Google Place ID 未確定行も保持する。'
);

ALTER TABLE `${DATASET}.restaurant_seed_catalog`
  ADD COLUMN IF NOT EXISTS country_code STRING;

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_seed_source_links` (
  run_id            STRING NOT NULL,
  seed_id           STRING NOT NULL,
  source            STRING NOT NULL,
  source_record_id  STRING NOT NULL,
  match_method      STRING NOT NULL,
  match_score       FLOAT64,
  distance_m        FLOAT64,
  linked_at         TIMESTAMP NOT NULL
)
CLUSTER BY source, source_record_id, seed_id
OPTIONS (
  description = 'source record がどの seed に統合されたかを追跡する。'
);

-- -----------------------------------------------------------------------------
-- 3. Google Place ID 名寄せ
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_google_place_match_attempts` (
  attempted_date       DATE NOT NULL,
  attempt_id           STRING NOT NULL,
  run_id               STRING NOT NULL,
  seed_id              STRING NOT NULL,
  algorithm_version    STRING NOT NULL,
  query_a              STRING NOT NULL,
  query_b              STRING NOT NULL,
  place_ids_a          ARRAY<STRING>,
  place_ids_b          ARRAY<STRING>,
  -- #1276 の PoC で、名寄せの根拠を「A と B の合意」から「座標矩形の中での一意性」へ
  -- 変えた。矩形（locationRestriction）は矩形の外を実際に切り落とすので、
  -- 「矩形の中に同名が1件しか無い」が「取り違える相手が居ない」を意味する。
  -- 合意ベースは負例で誤マッチ率 11.3% だった。locationBias が絞り込まないため、
  -- 店が Google に無ければ A も B も揃って隣の店を返してしまうのが原因である。
  -- 監査のため矩形 probe の結果も残す。判定を後から変えても再課金せず再評価できる。
  place_ids_tight_box  ARRAY<STRING>,
  place_ids_wide_box   ARRAY<STRING>,
  matched_place_id     STRING,
  result_status        STRING NOT NULL,
  http_status_a        INT64,
  http_status_b        INT64,
  http_status_tight_box INT64,
  http_status_wide_box  INT64,
  error_message        STRING,
  attempted_at         TIMESTAMP NOT NULL
)
PARTITION BY attempted_date
CLUSTER BY run_id, result_status, seed_id
OPTIONS (
  require_partition_filter = TRUE,
  description = 'Text Search IDs Only のダブルクエリ結果。Googleの名称・住所は保存しない。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_google_place_match_overrides` (
  seed_id           STRING NOT NULL,
  google_place_id   STRING,
  decision          STRING NOT NULL,
  reason            STRING NOT NULL,
  decided_by        STRING NOT NULL,
  decided_at        TIMESTAMP NOT NULL
)
OPTIONS (
  description = '誤名寄せの修正と手動確定。再生成しても失わない人手管理テーブル。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_google_place_match_catalog` (
  run_id             STRING NOT NULL,
  seed_id            STRING NOT NULL,
  google_place_id    STRING,
  match_status       STRING NOT NULL,
  match_method       STRING NOT NULL,
  match_confidence   FLOAT64,
  source_attempt_id  STRING,
  confirmed_at       TIMESTAMP,
  built_at           TIMESTAMP NOT NULL
)
CLUSTER BY match_status, google_place_id, seed_id
OPTIONS (
  description = '既存DB移植・ダブルクエリ・手動確定を統合した現在の採用結果。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_catalog` (
  run_id                   STRING NOT NULL,
  seed_id                  STRING NOT NULL,
  existing_restaurant_id   STRING,
  google_place_id          STRING NOT NULL,
  name                     STRING NOT NULL,
  name_language_code       STRING NOT NULL,
  latitude                 FLOAT64 NOT NULL,
  longitude                FLOAT64 NOT NULL,
  location                 GEOGRAPHY NOT NULL,
  image_url                STRING NOT NULL,
  image_path               STRING,
  address_components_json  STRING NOT NULL,
  plus_code_json           STRING,
  phone                    STRING,
  website                  STRING,
  social_urls              ARRAY<STRING>,
  source_names             ARRAY<STRING>,
  match_method             STRING NOT NULL,
  row_hash                 STRING NOT NULL,
  built_at                 TIMESTAMP NOT NULL
)
CLUSTER BY google_place_id, seed_id
OPTIONS (
  description = 'PostgreSQL restaurants へ同期してよい Google Place ID 確定行のみ。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_service_cell_catalog` (
  run_id            STRING NOT NULL,
  service_cell_id   INT64 NOT NULL,
  s2_level          INT64 NOT NULL,
  center            GEOGRAPHY NOT NULL,
  restaurant_count  INT64 NOT NULL,
  built_at          TIMESTAMP NOT NULL
)
CLUSTER BY service_cell_id
OPTIONS (
  description = 'coverage分母となる、公開可能restaurantが1件以上あるS2セル。'
);

-- -----------------------------------------------------------------------------
-- 4. SNS料理媒体、料理、Coverage
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.dish_media_social_raw` (
  observed_date               DATE NOT NULL,
  run_id                      STRING NOT NULL,
  dish_media_id               STRING NOT NULL,
  provider                    STRING NOT NULL,
  external_content_id         STRING NOT NULL,
  canonical_url               STRING NOT NULL,
  embed_html                  STRING,
  thumbnail_url               STRING,
  media_type                  STRING NOT NULL,
  published_at                TIMESTAMP,
  google_place_id             STRING,
  restaurant_match_method     STRING,
  restaurant_match_confidence FLOAT64,
  category_id                 STRING,
  category_match_method       STRING,
  category_confidence         FLOAT64,
  availability_status         STRING NOT NULL,
  rights_basis                STRING NOT NULL,
  terms_version               STRING,
  raw_payload_json            STRING,
  observed_at                 TIMESTAMP NOT NULL
)
PARTITION BY observed_date
CLUSTER BY provider, google_place_id, category_id
OPTIONS (
  require_partition_filter = TRUE,
  description = '許諾済み・公式API等で得た既知のSNS投稿URL。oEmbedは発見手段として扱わない。'
);

-- 初期migrationを途中まで適用した環境でも再実行で列を補えるようにする。
ALTER TABLE `${DATASET}.dish_media_social_raw`
  ADD COLUMN IF NOT EXISTS dish_media_id STRING;

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_media_external_state_catalog` (
  run_id                STRING NOT NULL,
  dish_media_id         STRING NOT NULL,
  provider              STRING NOT NULL,
  external_content_id   STRING NOT NULL,
  availability_status   STRING NOT NULL,
  last_verified_at      TIMESTAMP NOT NULL,
  built_at              TIMESTAMP NOT NULL
)
CLUSTER BY availability_status, provider, dish_media_id
OPTIONS (
  description = '最新観測の公開可否。unavailable/deleted/privateをPGへ伝えるtombstone catalog。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_media_classification_logs` (
  run_id               STRING NOT NULL,
  provider             STRING NOT NULL,
  external_content_id  STRING NOT NULL,
  classifier_version   STRING NOT NULL,
  category_id          STRING,
  confidence           FLOAT64,
  is_primary           BOOL NOT NULL,
  evidence_json        STRING,
  classified_at        TIMESTAMP NOT NULL
)
PARTITION BY DATE(classified_at)
CLUSTER BY classifier_version, category_id, provider
OPTIONS (
  require_partition_filter = TRUE,
  description = '1投稿に複数料理がある場合を含む分類ログ。PGへはprimary 1件だけを公開する。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_catalog` (
  run_id           STRING NOT NULL,
  google_place_id  STRING NOT NULL,
  category_id      STRING NOT NULL,
  name             STRING NOT NULL,
  built_at         TIMESTAMP NOT NULL
)
CLUSTER BY category_id, google_place_id
OPTIONS (
  description = 'PostgreSQL dishes への同期元。媒体が採用された店舗×料理だけを持つ。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_media_catalog` (
  run_id                      STRING NOT NULL,
  dish_media_id               STRING NOT NULL,
  google_place_id             STRING NOT NULL,
  category_id                 STRING NOT NULL,
  provider                    STRING NOT NULL,
  external_content_id         STRING NOT NULL,
  canonical_url               STRING NOT NULL,
  embed_html                  STRING,
  thumbnail_url               STRING,
  media_type                  STRING NOT NULL,
  published_at                TIMESTAMP,
  availability_status         STRING NOT NULL,
  restaurant_match_confidence FLOAT64 NOT NULL,
  category_confidence         FLOAT64 NOT NULL,
  rights_basis                STRING NOT NULL,
  terms_version               STRING,
  last_verified_at            TIMESTAMP NOT NULL,
  row_hash                    STRING NOT NULL,
  built_at                    TIMESTAMP NOT NULL
)
CLUSTER BY category_id, google_place_id, provider
OPTIONS (
  description = 'PostgreSQL dish_media と外部埋め込みテーブルへの同期元。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_media_coverage_catalog` (
  run_id                      STRING NOT NULL,
  service_cell_id             INT64 NOT NULL,
  category_id                 STRING NOT NULL,
  available_restaurant_count  INT64 NOT NULL,
  available_media_count       INT64 NOT NULL,
  target_restaurant_count     INT64 NOT NULL,
  shortage_count              INT64 NOT NULL,
  shortage_reason             STRING,
  calculated_at               TIMESTAMP NOT NULL
)
CLUSTER BY category_id, service_cell_id
OPTIONS (
  description = '対象エリア×134カテゴリの投入充足を観測する。クライアント挙動は変更しない。'
);

-- -----------------------------------------------------------------------------
-- 5. 将来機能の受け口（現時点では PostgreSQL へ同期しない）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_reviews_raw` (
  observed_date          DATE NOT NULL,
  run_id                 STRING NOT NULL,
  source                 STRING NOT NULL,
  source_review_id       STRING NOT NULL,
  source_restaurant_id   STRING,
  seed_id                STRING,
  google_place_id        STRING,
  rating_original        FLOAT64,
  rating_normalized      FLOAT64,
  review_text            STRING,
  language_code          STRING,
  source_url             STRING,
  author_pseudonym       STRING,
  published_at           TIMESTAMP,
  availability_status    STRING,
  rights_basis           STRING,
  terms_version          STRING,
  raw_payload_json       STRING,
  observed_at            TIMESTAMP NOT NULL
)
PARTITION BY observed_date
CLUSTER BY source, google_place_id
OPTIONS (
  require_partition_filter = TRUE,
  description = 'レビューの将来取込口。権利確認と配信仕様が決まるまでrawのみ。'
);

CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_details_raw` (
  observed_date         DATE NOT NULL,
  run_id                STRING NOT NULL,
  source                STRING NOT NULL,
  source_restaurant_id  STRING,
  seed_id               STRING,
  google_place_id       STRING,
  attribute_key         STRING NOT NULL,
  value_string          STRING,
  value_bool            BOOL,
  value_number          FLOAT64,
  value_json            STRING,
  valid_from            TIMESTAMP,
  valid_to              TIMESTAMP,
  confidence            FLOAT64,
  rights_basis          STRING,
  raw_payload_json      STRING,
  observed_at           TIMESTAMP NOT NULL
)
PARTITION BY observed_date
CLUSTER BY attribute_key, source, google_place_id
OPTIONS (
  require_partition_filter = TRUE,
  description = '営業時間・設備・決済等の観測値。機能化時に型付きcatalogへ昇格する。'
);

-- -----------------------------------------------------------------------------
-- 9. PostgreSQL publish 監査
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_pg_sync_logs` (
  run_id          STRING NOT NULL,
  sync_id         STRING NOT NULL,
  pg_schema       STRING NOT NULL,
  target_table    STRING NOT NULL,
  dry_run         BOOL NOT NULL,
  inserted_count  INT64 NOT NULL,
  updated_count   INT64 NOT NULL,
  skipped_count   INT64 NOT NULL,
  status          STRING NOT NULL,
  error_message   STRING,
  started_at      TIMESTAMP NOT NULL,
  finished_at     TIMESTAMP NOT NULL
)
PARTITION BY DATE(started_at)
CLUSTER BY run_id, pg_schema, target_table
OPTIONS (
  require_partition_filter = TRUE,
  description = '9_* の PostgreSQL 同期結果。'
);
