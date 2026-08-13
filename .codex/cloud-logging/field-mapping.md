# Cloud Logging Field Mapping

## Structured application logs

共通filter:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="api-production"
```

| log type     | discriminator                                | useful fields                                                                                             |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| frontend     | `jsonPayload.log_type="frontend_event_logs"` | `event_name`, `user_id`, `path_name`, `created_at`, `created_app_version`, `created_commit_id`, `payload` |
| backend      | `jsonPayload.log_type="backend_event_logs"`  | `event_name`, `function_name`, `user_id`, `request_id`, `created_commit_id`, `payload`                    |
| external API | `jsonPayload.log_type="external_api_logs"`   | `request_id`, `function_name`, `api_name`, `endpoint`, `method`, `status_code`, `error_message`, payloads |

## Time semantics

- Cloud Loggingのトップレベル `timestamp` は取り込み・サーバーログ時刻として使う。
- frontendの実発生時刻は `jsonPayload.created_at`。クライアントがbatch送信するため、トップレベル `timestamp` より前になりうる。
- frontendタイムラインは取得窓を後ろへ広めに取り、最終的に `jsonPayload.created_at` で並べる。
- backend/externalにはアプリ独自の `created_at` が無いため、トップレベル `timestamp` を使う。

## Payload representation

`AppLoggerService.convertToBigQueryRecord()` はobject/array/primitiveをJSON文字列化する。このためCloud Loggingでは次が文字列になりうる:

- `jsonPayload.payload`
- `jsonPayload.request_payload`
- `jsonPayload.response_payload`

Cloud Logging filterでは、まず `jsonPayload.payload:"needle"` の部分一致で候補を絞る。厳密なキー比較は取得後に `jq` の `fromjson?` で行う。

## Logs not represented by application views

Cloud RunのOOM、起動失敗、platform 503などは `backend_event_logs` に残らない場合がある。次も確認する:

- `httpRequest.status`
- `httpRequest.requestUrl`
- `textPayload`
- `severity`
- `resource.labels.revision_name`

アプリloggerが実行される前にコンテナが終了する障害は、BigQueryのアプリログviewだけでは見落としうる。
