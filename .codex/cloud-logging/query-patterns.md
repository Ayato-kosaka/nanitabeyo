# Cloud Logging Query Patterns

実行前に `access.md`、`safety-policy.md`、`field-mapping.md` を読む。

## Issue creation request

Issue作成時刻の前後10分で開始する。payloadは文字列なのでIssue番号・titleは部分一致で候補を絞り、取得後に検証する。

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND jsonPayload.log_type="backend_event_logs"
  AND jsonPayload.function_name="createIssue"
  AND timestamp>="{ISSUE_MINUS_10_MIN}"
  AND timestamp<="{ISSUE_PLUS_10_MIN}"
  AND jsonPayload.payload:"{ISSUE_NUMBER}"
' --project=food-scroll --order=asc --limit=50 --format=json
```

取得後、`payload | fromjson?` から `issueNumber`、`user_id`、`request_id`を確認する。

## User timeline

frontendはbatch遅延を考慮して、Issue前60分からIssue後30分程度の取り込み窓を使う。

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND jsonPayload.log_type="frontend_event_logs"
  AND jsonPayload.user_id="{USER_ID}"
  AND timestamp>="{ISSUE_MINUS_60_MIN}"
  AND timestamp<="{ISSUE_PLUS_30_MIN}"
' --project=food-scroll --order=asc --limit=200 --format=json
```

frontendは `jsonPayload.created_at`、backend/externalはトップレベル `timestamp` で時系列化する。

## Backend events for a user

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND jsonPayload.log_type="backend_event_logs"
  AND jsonPayload.user_id="{USER_ID}"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
' --project=food-scroll --order=asc --limit=200 --format=json
```

## Request trace across backend and external API logs

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND jsonPayload.request_id="{REQUEST_ID}"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
' --project=food-scroll --order=asc --limit=100 --format=json
```

## Event/error discovery

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND jsonPayload.log_type="backend_event_logs"
  AND jsonPayload.event_name="{EVENT_NAME}"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
' --project=food-scroll --order=asc --limit=100 --format=json
```

同じエラーのCloud Tasks retryを件数ではなく対象数として数える場合は、取得後に `recordId`、`originalPath`、`jobId`等で重複排除する。

## Cloud Run HTTP and system failures

endpointのHTTP status:

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND httpRequest.requestUrl:"{ENDPOINT_PATH}"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
' --project=food-scroll --order=asc --limit=100 \
  --format='table(timestamp,httpRequest.status,resource.labels.revision_name,httpRequest.requestUrl)'
```

OOM・platform errorの候補:

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
  AND (severity>=ERROR OR textPayload:"Memory limit")
' --project=food-scroll --order=asc --limit=100 --format=json
```

## Fallback

該当ログが無い、保持期間外、または集計が必要なら `.codex/bigquery/` を読み、Cloud Loggingで得たキーを使ってBigQueryをdry-runする。
