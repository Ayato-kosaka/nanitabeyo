# Cloud Logging Safety Policy

## Core rules

- 調査では読み取り専用にする。sink、bucket、retention、exclusion、IAMを変更しない。
- 必ず `timestamp` の上下限を指定する。最初はIssue時刻の前後10分から始める。
- service、`log_type`、event、request ID、user IDのうち判明している条件を付ける。
- 最初は `--limit=20`〜`100`。理由なく数千件を取得しない。
- raw payloadを多数表示しない。必要なキーだけ抽出する。
- Authorization header、Cookie、JWT、署名付きURL、メールアドレス等を回答・Issue・PRへ貼らない。
- 一時ファイルへ保存する場合は `/tmp` を使い、リポジトリへ追加しない。

## Cost and coverage

- `gcloud logging read` にはBigQueryの処理バイト数に基づくクエリ課金はない。
- ただしCloud Loggingの取り込み、保持、分析機能が常に無料とは限らない。「無料」と断定しない。
- 0件は不在の証明ではない。保持期間外、クライアントのbatch遅延、service/filter違い、構造化前のsystem logを疑う。
- 期間を7日超へ広げる、長期集計する、複数ログ種をJOINする場合は `.codex/bigquery/safety-policy.md` を読み、BigQueryのdry-runへ切り替える。

## Escalation to BigQuery

次の場合だけBigQueryを優先する:

- Cloud Loggingの保持期間外
- 数週間〜数か月の傾向分析
- frontend/backend/externalを多数のrequest IDで結合
- legacyテーブルとCloud Logging sinkの統合ビューが必要
- SQL集計でなければ答えられない

BigQueryへ切り替える際は、Cloud Loggingで得た `user_id`、`request_id`、event、時間帯を条件に渡し、探索範囲を狭める。
