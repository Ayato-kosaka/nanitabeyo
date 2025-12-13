# 実装完了サマリー - Supabase → BigQuery バックフィル (#531)

## ✅ 実装内容

### 1. BigQuery SQL マイグレーションファイル

**ファイル**: `infra/big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql`

- **ステージングテーブル（3つ）**: Supabase の生データを格納
  - `stg_frontend_event_logs`
  - `stg_backend_event_logs`
  - `stg_external_api_logs`
  - すべての payload 系カラムは STRING 型（CSV エクスポートに対応）

- **レガシーテーブル（3つ）**: VIEW 互換のスキーマ
  - `frontend_event_logs_legacy`
  - `backend_event_logs_legacy`
  - `external_api_logs_legacy`
  - payload 系カラムは JSON 型（#523 の VIEW と互換）

- **INSERT 処理**: ステージング → レガシーテーブル
  - `SAFE.PARSE_JSON()` で STRING → JSON 変換
  - 壊れた JSON があってもレコード単位で NULL に落とし、クエリ全体は失敗しない

- **VIEW の REPLACE**: legacy + Cloud Logging raw の UNION ALL
  - 既存の VIEW を上書き
  - Supabase 由来のレガシーデータ（過去ログ）
  - Cloud Logging Sink からの新規ログ
  - 両方のソースを単一の VIEW から参照可能

### 2. バックフィルオーケストレータスクリプト

**ファイル**: `infra/big-query/20251203T0000_backfill_supabase_logs_to_bigquery.sh`

- **環境サポート**: dev / prod
- **柔軟な GCS パス指定**:
  - デフォルトパス: `gs://{bucket}/supabase/*.csv`
  - カスタムパス: `gs://{bucket}/system/PostgreSQL/csv_export/{timestamp}/` (pg-table-export.yml の出力)
- **処理フロー**:
  1. GCS → BigQuery ステージングテーブルへ CSV ロード（`bq load`）
  2. BigQuery SQL 実行（`${DATASET}` プレースホルダを置換）
- **再実行可能**: `CREATE TABLE IF NOT EXISTS` で冪等性確保

### 3. 詳細ドキュメント

**ファイル**: `infra/big-query/README_BACKFILL.md`

- 前提条件
- 実行手順（2つの方法: デフォルトパス / カスタムパス）
- BigQuery での確認方法
- frontend_event_logs の削除ポリシー（max(created_at) 以前のみ削除）
- トラブルシューティング
- 受け入れ条件チェックリスト

## 📋 チケット要件との対応

| 要件                                        | 実装 | ファイル/行           |
| ------------------------------------------- | ---- | --------------------- |
| ステージングテーブル作成（Supabase 互換）   | ✅   | SQL: L31, L46, L61    |
| レガシーテーブル作成（VIEW 互換、JSON 型）  | ✅   | SQL: L83, L98, L113   |
| INSERT 時の JSON 変換（SAFE.PARSE_JSON）    | ✅   | SQL: L141, L167, L201 |
| VIEW の UNION ALL（legacy + Cloud Logging） | ✅   | SQL: L225, L260, L295 |
| dev/prod 両環境サポート                     | ✅   | スクリプト: L64-L99   |
| 柔軟な GCS パス対応                         | ✅   | スクリプト: L67-L91   |
| ${DATASET} プレースホルダ方式               | ✅   | スクリプト: L161-L164 |
| 実行手順ドキュメント                        | ✅   | README_BACKFILL.md    |

## 🎯 受け入れ条件（実装済み）

1. **BigQuery 構造**
   - ✅ ステージングテーブル（`stg_*`）: 3つ
   - ✅ レガシーテーブル（`*_legacy`）: 3つ
   - ✅ VIEW（UNION ALL）: 3つ

2. **バックフィル結果**
   - ✅ ステージング → レガシーテーブルへの INSERT ロジック実装
   - ✅ payload 系カラムの JSON 型変換（SAFE.PARSE_JSON）

3. **VIEW での一元参照**
   - ✅ legacy + Cloud Logging raw の UNION ALL 実装
   - ✅ #523 の VIEW 定義と互換性維持

4. **frontend_event_logs 削除ポリシー**
   - ✅ ドキュメントに max(created_at) を使った条件付き削除の手順を記載

5. **スクリプト実行性**
   - ✅ `./20251203T0000_backfill_supabase_logs_to_bigquery.sh dev|prod` で実行可能
   - ✅ GCS パスのカスタム指定も可能

## 🚀 実行方法（クイックスタート）

### 前提: Supabase → GCS エクスポート

GitHub Actions `pg-table-export.yml` を実行してテーブルをエクスポート。

### バックフィル実行

```bash
cd infra/big-query

# デフォルトパスを使用（ファイルを gs://{bucket}/supabase/ に配置済みの場合）
./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod

# または、エクスポートディレクトリを直接指定
TIMESTAMP_DIR="20241203-120000"  # 実際のタイムスタンプに置き換える
./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod \
  "gs://food-scroll-logs-prod/system/PostgreSQL/csv_export/${TIMESTAMP_DIR}"
```

### 確認

```sql
-- レガシーテーブルの件数確認
SELECT COUNT(*) FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy`;

-- JSON 型の確認
SELECT JSON_TYPE(payload) FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy` LIMIT 1;

-- VIEW からの統合参照確認
SELECT * FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs` ORDER BY created_at DESC LIMIT 10;
```

### Supabase データ削除

```sql
-- BigQuery で max(created_at) を取得
SELECT MAX(created_at) FROM `food-scroll.nanitabeyo_logs_prod.frontend_event_logs_legacy`;

-- Supabase 側で条件付き削除
DELETE FROM frontend_event_logs WHERE created_at <= TIMESTAMP 'YYYY-MM-DD HH:MM:SS';
```

## 📝 設計のポイント

### 1. 2段階変換アーキテクチャ

```
Supabase (TEXT/JSON)
  → GCS CSV (文字列)
    → BigQuery ステージング (STRING)
      → BigQuery レガシー (JSON)
        → VIEW (legacy ∪ Cloud Logging)
```

**理由**:

- CSV エクスポートでは JSON 型も文字列として出力される
- ステージングで一旦 STRING として取り込み、レガシーテーブルで JSON 型に変換
- 変換エラーがあっても `SAFE.PARSE_JSON` で NULL に落とし、処理継続

### 2. スキーマの互換性

- **ステージングテーブル**: Supabase のテーブル定義に準拠
- **レガシーテーブル**: #523 の VIEW 定義に準拠（JSON 型）
- **VIEW**: Cloud Logging Sink の raw テーブルと UNION ALL

これにより、既存の分析クエリをそのまま使用可能。

### 3. 柔軟な GCS パス対応

pg-table-export.yml は `gs://{bucket}/system/PostgreSQL/csv_export/{timestamp}/` に出力するため、スクリプトで2つの方法をサポート：

1. **デフォルトパス**: `gs://{bucket}/supabase/` から読み込み（事前にファイル移動が必要）
2. **カスタムパス**: タイムスタンプディレクトリを直接指定（ファイル移動不要）

### 4. frontend_event_logs の削除ポリシー

前バージョンではクライアントから直接挿入されていたため、全削除せずに BigQuery の `max(created_at)` 以前のデータのみ削除。

## 🔍 関連チケット

- #531: 本チケット（Supabase → BigQuery バックフィル）
- #523: Cloud Logging Sink セットアップ・VIEW 作成
- #487: BigQuery ログ基盤セットアップ

## 🎉 完了

本実装により、Supabase のログテーブルを BigQuery にバックフィルし、Cloud Logging Sink 経由の新規ログと統合して単一の VIEW から参照できる環境が整いました。

詳細な手順とトラブルシューティングは `infra/big-query/README_BACKFILL.md` を参照してください。
