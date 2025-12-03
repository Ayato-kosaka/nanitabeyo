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
-- ## 注意
-- - Cloud Logging Sink が --use-partitioned-tables で作成するテーブルから選択
-- - Sink フィルタは jsonPayload.log_type ベースで動作
-- - jsonPayload から各フィールドを抽出
-- - created_at は LogEntry の timestamp を使用
-- - VIEW 名は Supabase テーブル名と完全互換
-- - 各 VIEW は log_type でフィルタリングしてログ種別を分離
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- frontend_event_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, user_id, event_name, error_level, path_name, payload,
--   created_at, created_app_version, created_commit_id
--
-- Cloud Logging Sink raw テーブルから log_type="frontend_event_logs" を抽出
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
  `${DATASET}.cloudrun_googleapis_com_stdout_*`
WHERE
  JSON_VALUE(jsonPayload, '$.log_type') = 'frontend_event_logs';

-- -----------------------------------------------------------------------------
-- backend_event_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, event_name, error_level, function_name, user_id, payload,
--   request_id, created_at, created_commit_id
--
-- Cloud Logging Sink raw テーブルから log_type="backend_event_logs" を抽出
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
  `${DATASET}.cloudrun_googleapis_com_stdout_*`
WHERE
  JSON_VALUE(jsonPayload, '$.log_type') = 'backend_event_logs';

-- -----------------------------------------------------------------------------
-- external_api_logs VIEW
-- -----------------------------------------------------------------------------
-- Supabase カラム:
--   id, request_id, function_name, api_name, endpoint, method,
--   request_payload, response_payload, status_code, error_message,
--   response_time_ms, user_id, created_at, created_commit_id
--
-- Cloud Logging Sink raw テーブルから log_type="external_api_logs" を抽出
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
  `${DATASET}.cloudrun_googleapis_com_stdout_*`
WHERE
  JSON_VALUE(jsonPayload, '$.log_type') = 'external_api_logs';
