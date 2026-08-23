# Supabase → BigQuery バックフィル実装ガイド

## 概要

このドキュメントでは、Supabase（Postgres）のログテーブルを BigQuery にバックフィルする手順を説明します。

## 対象テーブル

- `frontend_event_logs`
- `backend_event_logs`
- `external_api_logs`

## 前提条件

1. **Supabase → GCS エクスポート**が完了していること
   - GitHub Actions `pg-table-export.yml` を使用してエクスポート
   - GCS 上の以下のパスに CSV ファイルが配置されている：
     - dev: `gs://food-scroll-logs-dev/supabase/*.csv`
     - prod: `gs://food-scroll-logs-prod/supabase/*.csv`

2. **BigQuery Dataset が作成済み**であること
   - `food-scroll.nanitabeyo_logs_dev`
   - `food-scroll.nanitabeyo_logs_prod`
   - ロケーション: `asia-northeast1`

3. **Cloud Logging Sink** が設定済みであること（#523 で実装済み）

4. **権限**
   - BigQuery Admin または BigQuery Data Editor
   - Cloud Storage Object Viewer
   - gcloud CLI で `food-scroll` プロジェクトにアクセス可能

## 実行手順

### 1. Supabase データを GCS にエクスポート

GitHub Actions の `pg-table-export.yml` を使用して、各テーブルを GCS にエクスポートします。

#### dev 環境のエクスポート

```bash
# GitHub Actions UI から以下のパラメータで実行
# workflow: PostgreSQL Export Table(s) to CSV
# schema: public
# table_name: frontend_event_logs,backend_event_logs,external_api_logs
```

または個別にエクスポート：

```bash
# frontend_event_logs
# schema: public
# table_name: frontend_event_logs

# backend_event_logs
# schema: public
# table_name: backend_event_logs

# external_api_logs
# schema: public
# table_name: external_api_logs
```

#### prod 環境のエクスポート

dev 環境と同様の手順で実行します。

#### エクスポート後の確認

GCS バケット上にファイルが配置されていることを確認します：

```bash
# エクスポートされたディレクトリの一覧を確認
# dev 環境
gsutil ls gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/

# prod 環境
gsutil ls gs://food-scroll-logs-prod/system/PostgreSQL/csv_export/

# 特定のタイムスタンプディレクトリ内のファイルを確認
gsutil ls gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/20241203-120000/
```

エクスポートされたファイルのタイムスタンプディレクトリパス（例: `20241203-120000`）をメモしておきます。

#### オプション: ファイルを専用ディレクトリに移動/コピー

バックフィルスクリプトのデフォルトパスを使用する場合、ファイルを移動またはコピーします：

```bash
# dev 環境の例
TIMESTAMP_DIR="20241203-120000"  # 実際のタイムスタンプに置き換える

gsutil cp gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}/frontend_event_logs.csv \
          gs://food-scroll-logs-dev/supabase/
gsutil cp gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}/backend_event_logs.csv \
          gs://food-scroll-logs-dev/supabase/
gsutil cp gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}/external_api_logs.csv \
          gs://food-scroll-logs-dev/supabase/
```

**注意**: ファイル移動せずに、バックフィルスクリプトの第2引数でタイムスタンプディレクトリパスを指定することもできます（次のステップを参照）。

### 2. バックフィルスクリプトの実行

バックフィルスクリプトは2つの方法で実行できます：

#### 方法1: デフォルトパスを使用（ファイルを事前に移動した場合）

```bash
cd infra/big-query

# dev 環境でのバックフィル
./20251203T0000_backfill_supabase_logs_to_bigquery.sh dev

# prod 環境でのバックフィル
./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod
```

この方法では、以下のパスからファイルを読み込みます：

- dev: `gs://food-scroll-logs-dev/supabase/*.csv`
- prod: `gs://food-scroll-logs-prod/supabase/*.csv`

#### 方法2: エクスポートディレクトリを直接指定

```bash
cd infra/big-query

# dev 環境でのバックフィル（タイムスタンプディレクトリを指定）
TIMESTAMP_DIR="20241203-120000"  # 実際のタイムスタンプに置き換える
./20251203T0000_backfill_supabase_logs_to_bigquery.sh dev \
  "gs://food-scroll-logs-dev/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}"

# prod 環境でのバックフィル
TIMESTAMP_DIR="20241203-120000"  # 実際のタイムスタンプに置き換える
./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod \
  "gs://food-scroll-logs-prod/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}"
```

この方法では、pg-table-export.yml で生成されたタイムスタンプディレクトリから直接ファイルを読み込みます。

#### スクリプトの処理内容

1. **GCS → BigQuery ステージングテーブルへのロード**
   - `bq load` コマンドで CSV をロード
   - ステージングテーブル：
     - `stg_frontend_event_logs`
     - `stg_backend_event_logs`
     - `stg_external_api_logs`

2. **BigQuery SQL の実行**
   - ステージングテーブル作成（IF NOT EXISTS）
   - レガシーテーブル作成（IF NOT EXISTS）
   - ステージング → レガシーテーブルへの INSERT（JSON 変換）
   - VIEW の REPLACE（legacy + Cloud Logging raw の UNION ALL）

### 3. BigQuery での確認

#### ステージングテーブルの確認

```sql
-- dev 環境
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.stg_frontend_event_logs`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.stg_backend_event_logs`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.stg_external_api_logs`;

-- prod 環境
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.stg_frontend_event_logs`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.stg_backend_event_logs`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.stg_external_api_logs`;
```

#### レガシーテーブルの確認

```sql
-- dev 環境
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.frontend_event_logs_legacy`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.backend_event_logs_legacy`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_dev.external_api_logs_legacy`;

-- prod 環境
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.backend_event_logs_legacy`;
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.external_api_logs_legacy`;
```

#### JSON 型の確認

```sql
-- payload が JSON 型になっていることを確認
SELECT
  JSON_TYPE(payload) AS payload_type,
  payload
FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy`
LIMIT 10;
```

#### VIEW の確認（legacy + Cloud Logging の統合）

```sql
-- VIEW から両方のソースが見えることを確認
SELECT
  created_at,
  event_name,
  JSON_TYPE(payload) AS payload_type
FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
ORDER BY created_at DESC
LIMIT 100;
```

### 4. frontend_event_logs の max(created_at) 取得

**重要**: frontend_event_logs は前バージョンでクライアントから直接挿入されているため、全削除しません。

#### BigQuery 側で max(created_at) を取得

```sql
SELECT
  MAX(created_at) AS max_created_at
FROM
  `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy`;
```

#### Supabase 側で条件付き削除

取得した `max_created_at` を使用して、Supabase 側で削除を実行します：

```sql
-- max_created_at の値を置き換えて実行
DELETE FROM frontend_event_logs
WHERE created_at <= TIMESTAMP '2024-12-03 12:00:00';
```

**注意**: この操作は元に戻せません。必ず BigQuery 側のデータを確認してから実行してください。

### 5. backend / external_api の削除判断

backend_event_logs と external_api_logs については、全件バックフィルした前提で全削除するか判断します。

#### 全削除する場合

```sql
-- backend_event_logs の全削除
DELETE FROM backend_event_logs;

-- external_api_logs の全削除
DELETE FROM external_api_logs;
```

#### 条件付き削除する場合（frontend と同様）

```sql
-- BigQuery 側で max(created_at) を取得
SELECT MAX(created_at) FROM `food-scroll.nanitabeyo_logs_prod.backend_event_logs_legacy`;
SELECT MAX(created_at) FROM `food-scroll.nanitabeyo_logs_prod.external_api_logs_legacy`;

-- Supabase 側で条件付き削除
DELETE FROM backend_event_logs WHERE created_at <= TIMESTAMP 'YYYY-MM-DD HH:MM:SS';
DELETE FROM external_api_logs WHERE created_at <= TIMESTAMP 'YYYY-MM-DD HH:MM:SS';
```

## トラブルシューティング

### GCS ファイルが見つからない

```bash
# エラー: Not found: gs://food-scroll-logs-dev/supabase/frontend_event_logs.csv

# 解決策: GitHub Actions で再度エクスポートを実行
```

### bq load で CSV のパースエラー

```bash
# エラー: Could not parse 'YYYY-MM-DD' as TIMESTAMP

# 解決策: CSV のフォーマットを確認し、必要に応じて --allow_jagged_rows オプションを調整
```

### INSERT でデータが重複する

```bash
# 原因: スクリプトを複数回実行した

# 解決策: ステージングテーブルをクリアしてから再実行
bq rm -t -f food-scroll:nanitabeyo_logs_dev.stg_frontend_event_logs
bq rm -t -f food-scroll:nanitabeyo_logs_dev.frontend_event_logs_legacy
# その後、スクリプトを再実行
```

### VIEW が見つからない

```bash
# エラー: Not found: Table food-scroll:nanitabeyo_logs_dev.cloudrun_googleapis_com_stdout_*

# 原因: Cloud Logging Sink がまだログを送信していない

# 解決策:
# 1. Cloud Logging Sink が正しく設定されているか確認
# 2. Cloud Run からログが出力されているか確認
# 3. 一旦 VIEW を手動で修正するか、ログが流れるのを待つ
```

## ファイル構成

```
infra/big-query/
├── 20251203T0000_backfill_supabase_logs_to_bigquery.sh  # バックフィル実行スクリプト
├── migration/
│   └── 20251203T0000_backfill_legacy_log_tables_and_views.sql  # BigQuery SQL
└── backfill-runbook.md # このドキュメント
```

## 受け入れ条件チェックリスト

- [ ] BigQuery に以下のテーブルが作成されている
  - [ ] `stg_*` ステージングテーブル（3つ）
  - [ ] `*_legacy` レガシーテーブル（3つ）
  - [ ] VIEW が REPLACE されている（3つ）

- [ ] レガシーテーブルにデータが投入されている
  - [ ] `payload` / `request_payload` / `response_payload` が JSON 型になっている

- [ ] VIEW から両方のソースが参照できる
  - [ ] Supabase 由来のレガシーデータ
  - [ ] Cloud Logging Sink からの新規ログ

- [ ] frontend_event_logs の削除が完了している
  - [ ] BigQuery の `max(created_at)` 以前のデータのみ削除されている

- [ ] スクリプトが正常に実行できる
  - [ ] dev 環境
  - [ ] prod 環境

## 参考リンク

- チケット: #531
- 関連チケット: #523（Cloud Logging Sink セットアップ）
- 関連チケット: #487（BigQuery ログ基盤セットアップ）
