-- ==============================================================================
-- 20251203T0000_backfill_legacy_log_tables_and_views.sql
-- ==============================================================================
-- チケット #531 Supabase ログテーブル → BigQuery へのバックフィル実装
--
-- ## 目的
-- Supabase（Postgres）のログテーブルを BigQuery にバックフィルし、
-- Cloud Logging Sink 経由の新規ログと統合して参照できるようにする。
--
-- ## 使い方
-- orchestrator スクリプトから実行される。
-- ${DATASET} はスクリプト側で置換される。
--
-- ## 処理内容
-- 1. ステージングテーブル作成（Supabase 生データ用） ※CSV インポートで作成されるためコメントアウト
-- 2. レガシーテーブル作成（VIEW 互換スキーマ）
-- 3. ステージング → レガシーテーブルへの INSERT（JSON 変換）
-- 4. VIEW の REPLACE（legacy + Cloud Logging raw の UNION ALL）
--
-- ## 対象テーブル
-- - frontend_event_logs
-- - backend_event_logs
-- - external_api_logs
-- ==============================================================================


-- -- -----------------------------------------------------------------------------
-- -- 1-1. ステージングテーブル作成：stg_frontend_event_logs
-- -- -----------------------------------------------------------------------------
-- -- Supabase のテーブル定義に準拠（payload は STRING）
-- -- -----------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS `${DATASET}.stg_frontend_event_logs` (
--   id STRING,
--   user_id STRING,
--   event_name STRING,
--   error_level STRING,
--   path_name STRING,
--   payload STRING,
--   created_at TIMESTAMP,
--   created_app_version STRING,
--   created_commit_id STRING
-- );

-- -- -----------------------------------------------------------------------------
-- -- 1-2. ステージングテーブル作成：stg_backend_event_logs
-- -- -----------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS `${DATASET}.stg_backend_event_logs` (
--   id STRING,
--   event_name STRING,
--   error_level STRING,
--   function_name STRING,
--   user_id STRING,
--   payload STRING,
--   request_id STRING,
--   created_at TIMESTAMP,
--   created_commit_id STRING
-- );

-- -- -----------------------------------------------------------------------------
-- -- 1-3. ステージングテーブル作成：stg_external_api_logs
-- -- -----------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS `${DATASET}.stg_external_api_logs` (
--   id STRING,
--   request_id STRING,
--   function_name STRING,
--   api_name STRING,
--   endpoint STRING,
--   method STRING,
--   request_payload STRING,
--   response_payload STRING,
--   status_code INT64,
--   error_message STRING,
--   response_time_ms INT64,
--   user_id STRING,
--   created_at TIMESTAMP,
--   created_commit_id STRING
-- );

-- -----------------------------------------------------------------------------
-- 2-1. レガシーテーブル作成：frontend_event_logs_legacy
-- -----------------------------------------------------------------------------
-- #523 で定義した VIEW と互換（payload は JSON 型）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.frontend_event_logs_legacy` (
  id STRING,
  user_id STRING,
  event_name STRING,
  error_level STRING,
  path_name STRING,
  payload JSON,
  created_at TIMESTAMP,
  created_app_version STRING,
  created_commit_id STRING
);

-- -----------------------------------------------------------------------------
-- 2-2. レガシーテーブル作成：backend_event_logs_legacy
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.backend_event_logs_legacy` (
  id STRING,
  event_name STRING,
  error_level STRING,
  function_name STRING,
  user_id STRING,
  payload JSON,
  request_id STRING,
  created_at TIMESTAMP,
  created_commit_id STRING
);

-- -----------------------------------------------------------------------------
-- 2-3. レガシーテーブル作成：external_api_logs_legacy
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `${DATASET}.external_api_logs_legacy` (
  id STRING,
  request_id STRING,
  function_name STRING,
  api_name STRING,
  endpoint STRING,
  method STRING,
  request_payload JSON,
  response_payload JSON,
  status_code INT64,
  error_message STRING,
  response_time_ms INT64,
  user_id STRING,
  created_at TIMESTAMP,
  created_commit_id STRING
);

-- -----------------------------------------------------------------------------
-- 3-1. ステージング → レガシーテーブルへの INSERT：frontend_event_logs
-- -----------------------------------------------------------------------------
-- payload を SAFE.PARSE_JSON で JSON 型に変換
-- -----------------------------------------------------------------------------
INSERT INTO `${DATASET}.frontend_event_logs_legacy` (
  id,
  user_id,
  event_name,
  error_level,
  path_name,
  payload,
  created_at,
  created_app_version,
  created_commit_id
)
SELECT
  id,
  user_id,
  event_name,
  error_level,
  path_name,
  SAFE.PARSE_JSON(payload) AS payload,
  created_at,
  created_app_version,
  created_commit_id
FROM `${DATASET}.stg_frontend_event_logs`;

-- -----------------------------------------------------------------------------
-- 3-2. ステージング → レガシーテーブルへの INSERT：backend_event_logs
-- -----------------------------------------------------------------------------
INSERT INTO `${DATASET}.backend_event_logs_legacy` (
  id,
  event_name,
  error_level,
  function_name,
  user_id,
  payload,
  request_id,
  created_at,
  created_commit_id
)
SELECT
  id,
  event_name,
  error_level,
  function_name,
  user_id,
  SAFE.PARSE_JSON(payload) AS payload,
  request_id,
  created_at,
  created_commit_id
FROM `${DATASET}.stg_backend_event_logs`;

-- -----------------------------------------------------------------------------
-- 3-3. ステージング → レガシーテーブルへの INSERT：external_api_logs
-- -----------------------------------------------------------------------------
INSERT INTO `${DATASET}.external_api_logs_legacy` (
  id,
  request_id,
  function_name,
  api_name,
  endpoint,
  method,
  request_payload,
  response_payload,
  status_code,
  error_message,
  response_time_ms,
  user_id,
  created_at,
  created_commit_id
)
SELECT
  id,
  request_id,
  function_name,
  api_name,
  endpoint,
  method,
  SAFE.PARSE_JSON(request_payload) AS request_payload,
  SAFE.PARSE_JSON(response_payload) AS response_payload,
  status_code,
  error_message,
  response_time_ms,
  user_id,
  created_at,
  created_commit_id
FROM `${DATASET}.stg_external_api_logs`;

-- -----------------------------------------------------------------------------
-- 4-1. VIEW の REPLACE：frontend_event_logs
-- -----------------------------------------------------------------------------
-- Supabase 由来のレガシーデータ + Cloud Logging Sink からの新規ログ
--
-- `created_at` は、全データソースで「イベントが発生した時刻」を返す契約とする。
-- Cloud Logging の `timestamp` は API stdout の取込時刻であり、クライアント側の
-- バッチ送信・リトライによって発生時刻より遅れるため、新規ログの主時刻には使わない。
-- 一方、`jsonPayload.created_at` がない過去の Cloud Logging ログは、従来どおり
-- `timestamp` を返す。これにより既存データの View 結果を変えずに移行できる。
-- Sink の `jsonPayload` は固定 STRUCT のため、列追加前でも View を作れるように
-- JSON 化して取得する。新旧 API・Sink スキーマの混在期間も同じフォールバックを守る。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.frontend_event_logs` AS
-- 1) Supabase 由来のレガシーデータ
SELECT
  id,
  user_id,
  event_name,
  error_level,
  path_name,
  payload,
  created_at,
  created_app_version,
  created_commit_id
FROM `${DATASET}.frontend_event_logs_legacy`

UNION ALL

-- 2) Cloud Logging Sink からの新規ログ（#523 の定義をそのまま利用）
SELECT
  jsonPayload.id AS id,
  jsonPayload.user_id AS user_id,
  jsonPayload.event_name AS event_name,
  jsonPayload.error_level AS error_level,
  jsonPayload.path_name AS path_name,
  SAFE.PARSE_JSON(jsonPayload.payload) AS payload,
  -- 不正・未出力の時刻では、分析を止めずに従来の取込時刻へ戻す。
  COALESCE(
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.created_at') AS TIMESTAMP),
    timestamp
  ) AS created_at,
  jsonPayload.created_app_version AS created_app_version,
  jsonPayload.created_commit_id AS created_commit_id
FROM
  `${DATASET}.run_googleapis_com_stdout`
WHERE
  jsonPayload.log_type = 'frontend_event_logs';

-- -----------------------------------------------------------------------------
-- 4-2. VIEW の REPLACE：backend_event_logs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.backend_event_logs` AS
-- 1) Supabase 由来のレガシーデータ
SELECT
  id,
  event_name,
  error_level,
  function_name,
  user_id,
  payload,
  request_id,
  created_at,
  created_commit_id
FROM `${DATASET}.backend_event_logs_legacy`

UNION ALL

-- 2) Cloud Logging Sink からの新規ログ
SELECT
  jsonPayload.id AS id,
  jsonPayload.event_name AS event_name,
  jsonPayload.error_level AS error_level,
  jsonPayload.function_name AS function_name,
  jsonPayload.user_id AS user_id,
  SAFE.PARSE_JSON(jsonPayload.payload) AS payload,
  jsonPayload.request_id AS request_id,
  timestamp AS created_at,
  jsonPayload.created_commit_id AS created_commit_id
FROM
  `${DATASET}.run_googleapis_com_stdout`
WHERE
  jsonPayload.log_type = 'backend_event_logs';

-- -----------------------------------------------------------------------------
-- 4-3. VIEW の REPLACE：external_api_logs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.external_api_logs` AS
-- 1) Supabase 由来のレガシーデータ
SELECT
  id,
  request_id,
  function_name,
  api_name,
  endpoint,
  method,
  request_payload,
  response_payload,
  status_code,
  error_message,
  response_time_ms,
  user_id,
  created_at,
  created_commit_id
FROM `${DATASET}.external_api_logs_legacy`

UNION ALL

-- 2) Cloud Logging Sink からの新規ログ
SELECT
  jsonPayload.id AS id,
  jsonPayload.request_id AS request_id,
  jsonPayload.function_name AS function_name,
  jsonPayload.api_name AS api_name,
  jsonPayload.endpoint AS endpoint,
  jsonPayload.method AS method,
  SAFE.PARSE_JSON(jsonPayload.request_payload) AS request_payload,
  SAFE.PARSE_JSON(jsonPayload.response_payload) AS response_payload,
  SAFE_CAST(jsonPayload.status_code AS INT64) AS status_code,
  -- 存在しなければ NULL になる
  JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.error_message') AS error_message,
  SAFE_CAST(jsonPayload.response_time_ms AS INT64) AS response_time_ms,
  jsonPayload.user_id AS user_id,
  timestamp AS created_at,
  jsonPayload.created_commit_id AS created_commit_id
FROM
  `${DATASET}.run_googleapis_com_stdout`
WHERE
  jsonPayload.log_type = 'external_api_logs';
