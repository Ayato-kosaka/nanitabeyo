---
name: user-feedback-forensics
description: Investigate GitHub user-feedback issues by tracing recent Cloud Logging events first, falling back to BigQuery for retained history, aggregation, joins, or legacy logs, and correlating evidence with the nanitabeyo codebase. Use for feedback triage, user/session timelines, production incident reconstruction, and root-cause reports.
---

# User Feedback Forensics

## Purpose

GitHub Issueとして投稿されたユーザーフィードバックを起点に、ログとコードを照合し、ユーザーが実際に困った事象を特定する。

## Required references

最初に次を読む:

- `.codex/cloud-logging/README.md`
- `.codex/cloud-logging/access.md`
- `.codex/cloud-logging/safety-policy.md`
- `.codex/cloud-logging/field-mapping.md`
- `.codex/cloud-logging/query-patterns.md`

BigQueryへ切り替える場合だけ次を読む:

- `.codex/bigquery/access.md`
- `.codex/bigquery/safety-policy.md`
- `.codex/bigquery/schemas.md`
- `.codex/bigquery/query-patterns.md`
- `.codex/bigquery/event-catalog.md`
- `infra/big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql`

## Source selection

既定は **Cloud Logging first, BigQuery fallback** とする。

Cloud Loggingを使う:

- 直近の個別Issue
- request ID / user ID / event名が分かる調査
- Cloud Run HTTP status、revision、OOM、platform error
- 前後数十分のfrontend/backend/external API trace

BigQueryへ切り替える:

- Cloud Loggingの保持期間外
- 数週間〜数か月の傾向・集計
- 多数のrequest IDやログ種をJOIN
- legacyログとの横断
- Cloud Loggingで0件になり、保持・filter・batch遅延を確認しても不足する

Cloud Loggingで0件でも「事象なし」と断定しない。BigQueryへ切り替える際は、先に得た時間帯、user ID、request ID、event名で絞り、必ずdry-runする。推定1 GB以上なら実行前にユーザー確認を取る。

## Important caveats

- Issue本文の `App Version` は `api/src/v1/feedback/feedback.service.ts` の `env.API_COMMIT_ID` であり、クライアントversionではない。
- クライアントbuildはfrontendログの `created_app_version` と `created_commit_id` で確認する。
- frontendのトップレベルCloud Logging `timestamp` はbatch取り込み時刻。実発生時刻は `jsonPayload.created_at`。
- `jsonPayload.payload`等はJSON文字列になりうる。取得後に `jq` の `fromjson?` で必要な行だけ展開する。
- OOMやplatform 503はアプリlogger実行前に落ち、BigQueryのアプリログviewに残らない場合がある。Cloud RunのHTTP/system logも確認する。
- PostgreSQLの本番状態が必要な場合は `scripts/.env` の `DATABASE_URL` を読み取り専用で使い、`public` schemaだけを調べる。データを変更しない。

## Investigation flow

### 1. Read the GitHub Issue

title、body、labels、created_at、updated_atから次を抽出する:

- feedback message
- submitted timestamp
- backend commitとしてのApp Version
- OS / device
- likely user-facing flow

本文を根本原因とみなさず、UX文脈の仮説として扱う。

### 2. Identify the feedback request in Cloud Logging

Issue時刻の前後10分、`function_name="createIssue"`、Issue番号で候補を取得する。`payload | fromjson?` でIssue番号を照合し、次を特定する:

- `user_id`
- feedback `request_id`
- event timestamp

### 3. Trace the user timeline

Cloud LoggingでfrontendをIssue前60分〜Issue後30分の取り込み窓から取得する。実際の順序は `jsonPayload.created_at` で並べ、次を確認する:

- screen/path flow
- app version / client commit
- error / retry / navigation events
- feedback直前の操作

### 4. Trace backend and external calls

同じuser ID・時間帯でbackendを取得する。関係するrequest IDが分かったら、backendとexternal APIログをrequest IDで追う。

payload全文を並べず、原因を証明するキーだけ抽出する。

### 5. Inspect Cloud Run failures

該当endpointの `httpRequest.status`、revision、severity、system/text logを確認する。アプリイベントが無い場合も、OOM、起動失敗、timeout、platform 503を除外する。

### 6. Fall back to BigQuery when needed

保持期間外や集計・JOINが必要なときだけBigQueryを使う。Cloud Loggingで得たキーを条件に渡し、`.codex/bigquery/safety-policy.md`に従う。

### 7. Inspect code

ログで特定したfunction/event/APIからコードを追う:

- controller → service → repository → assembler/converter
- DTO / response type
- retry / fallback / idempotency
- client表示条件

ログ証拠とコード証拠が一致するまで修正を断定しない。

## Output

日本語で、意思決定に必要な証拠だけを報告する:

1. 結論
2. フィードバック概要と真の意図
3. 特定したIssue / user ID / request ID / app build
4. ユーザー行動の時系列
5. Cloud Loggingで確認した事実
6. BigQueryで確認した事実（使用した場合だけ。未使用なら明記）
7. コード上の原因
8. 根本原因の仮説と確信度
9. 修正方針と最小回帰テスト

事実と推論を分離する。raw logや大きなpayloadを貼らない。コードを変更していない場合は明記する。調査のみではデータを変更しない。
