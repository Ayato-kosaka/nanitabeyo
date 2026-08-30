# BigQuery Schemas

> **Before running any of these queries:** the `*_event_logs` views cannot prune partitions,
> so a time-ranged query against them costs 18.4 GB/day instead of ~77 MB.
> Rewrite time-ranged queries onto `run_googleapis_com_stdout` filtered on `timestamp`.
> See [safety-policy.md](./safety-policy.md).

Canonical schema reference:

- `infra/big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql`

Production dataset:

- `food-scroll.nanitabeyo_logs_prod`

Primary investigation views:

- `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
- `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
- `food-scroll.nanitabeyo_logs_prod.external_api_logs`

## frontend_event_logs

Columns:

- `id STRING`
- `user_id STRING`
- `event_name STRING`
- `error_level STRING`
- `path_name STRING`
- `payload JSON`
- `created_at TIMESTAMP`
- `created_app_version STRING`
- `created_commit_id STRING`

Source:

- legacy table: `frontend_event_logs_legacy`
- Cloud Logging rows where `jsonPayload.log_type = 'frontend_event_logs'`

## backend_event_logs

Columns:

- `id STRING`
- `event_name STRING`
- `error_level STRING`
- `function_name STRING`
- `user_id STRING`
- `payload JSON`
- `request_id STRING`
- `created_at TIMESTAMP`
- `created_commit_id STRING`

Source:

- legacy table: `backend_event_logs_legacy`
- Cloud Logging rows where `jsonPayload.log_type = 'backend_event_logs'`

## external_api_logs

Columns:

- `id STRING`
- `request_id STRING`
- `function_name STRING`
- `api_name STRING`
- `endpoint STRING`
- `method STRING`
- `request_payload JSON`
- `response_payload JSON`
- `status_code INT64`
- `error_message STRING`
- `response_time_ms INT64`
- `user_id STRING`
- `created_at TIMESTAMP`
- `created_commit_id STRING`

Source:

- legacy table: `external_api_logs_legacy`
- Cloud Logging rows where `jsonPayload.log_type = 'external_api_logs'`
