-- ==============================================================================
-- 20251201T0000_create_log_views.sql
-- ==============================================================================
-- チケット #487 Cloud Logging / BigQuery ログ基盤セットアップ（dev / prod）
--
-- ## 目的
-- Cloud Logging Sink が自動生成する raw テーブルから、
-- Supabase 互換スキーマの VIEW を作成する。
--
-- ## 使い方
-- orchestrator スクリプトから実行される。
-- ${DATASET} はスクリプト側で置換される。
--
-- ## 対象 VIEW（Supabase 互換名）
-- - frontend_event_logs
-- - backend_event_logs
-- - external_api_logs
--
-- ## raw テーブル（Cloud Logging Sink 自動生成）
-- - raw_frontend_event_logs
-- - raw_backend_event_logs
-- - raw_external_api_logs
--
-- ## 注意
-- - Cloud Logging Sink が --use-partitioned-tables で作成するテーブルは
--   logName に基づいて命名される
-- - jsonPayload から各フィールドを抽出
-- - created_at は LogEntry の timestamp を使用
-- - VIEW 名は Supabase テーブル名と完全互換
-- - raw テーブルは raw_ プレフィックスで命名（VIEW 名との衝突回避）
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- frontend_event_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, user_id, event_name, error_level, path_name, payload,
--   created_at, created_app_version, created_commit_id
--
-- Cloud Logging Sink raw テーブル: raw_frontend_event_logs（時系列パーティション）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.frontend_event_logs` AS
SELECT
  JSON_VALUE(jsonPayload, '$.id') AS id,
  JSON_VALUE(jsonPayload, '$.user_id') AS user_id,
  JSON_VALUE(jsonPayload, '$.event_name') AS event_name,
  JSON_VALUE(jsonPayload, '$.error_level') AS error_level,
  JSON_VALUE(jsonPayload, '$.path_name') AS path_name,
  SAFE.PARSE_JSON(JSON_VALUE(jsonPayload, '$.payload')) AS payload,
  timestamp AS created_at,
  JSON_VALUE(jsonPayload, '$.created_app_version') AS created_app_version,
  JSON_VALUE(jsonPayload, '$.created_commit_id') AS created_commit_id
FROM
  `${DATASET}.raw_frontend_event_logs`;

-- -----------------------------------------------------------------------------
-- backend_event_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, event_name, error_level, function_name, user_id, payload,
--   request_id, created_at, created_commit_id
--
-- Cloud Logging Sink raw テーブル: raw_backend_event_logs（時系列パーティション）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.backend_event_logs` AS
SELECT
  JSON_VALUE(jsonPayload, '$.id') AS id,
  JSON_VALUE(jsonPayload, '$.event_name') AS event_name,
  JSON_VALUE(jsonPayload, '$.error_level') AS error_level,
  JSON_VALUE(jsonPayload, '$.function_name') AS function_name,
  JSON_VALUE(jsonPayload, '$.user_id') AS user_id,
  SAFE.PARSE_JSON(JSON_VALUE(jsonPayload, '$.payload')) AS payload,
  JSON_VALUE(jsonPayload, '$.request_id') AS request_id,
  timestamp AS created_at,
  JSON_VALUE(jsonPayload, '$.created_commit_id') AS created_commit_id
FROM
  `${DATASET}.raw_backend_event_logs`;

-- -----------------------------------------------------------------------------
-- external_api_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, request_id, function_name, api_name, endpoint, method,
--   request_payload, response_payload, status_code, error_message,
--   response_time_ms, user_id, created_at, created_commit_id
--
-- Cloud Logging Sink raw テーブル: raw_external_api_logs（時系列パーティション）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `${DATASET}.external_api_logs` AS
SELECT
  JSON_VALUE(jsonPayload, '$.id') AS id,
  JSON_VALUE(jsonPayload, '$.request_id') AS request_id,
  JSON_VALUE(jsonPayload, '$.function_name') AS function_name,
  JSON_VALUE(jsonPayload, '$.api_name') AS api_name,
  JSON_VALUE(jsonPayload, '$.endpoint') AS endpoint,
  JSON_VALUE(jsonPayload, '$.method') AS method,
  SAFE.PARSE_JSON(JSON_VALUE(jsonPayload, '$.request_payload')) AS request_payload,
  SAFE.PARSE_JSON(JSON_VALUE(jsonPayload, '$.response_payload')) AS response_payload,
  SAFE_CAST(JSON_VALUE(jsonPayload, '$.status_code') AS INT64) AS status_code,
  JSON_VALUE(jsonPayload, '$.error_message') AS error_message,
  SAFE_CAST(JSON_VALUE(jsonPayload, '$.response_time_ms') AS INT64) AS response_time_ms,
  JSON_VALUE(jsonPayload, '$.user_id') AS user_id,
  timestamp AS created_at,
  JSON_VALUE(jsonPayload, '$.created_commit_id') AS created_commit_id
FROM
  `${DATASET}.raw_external_api_logs`;
