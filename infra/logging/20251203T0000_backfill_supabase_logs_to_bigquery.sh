#!/usr/bin/env bash

# 変更チケット #531 Supabase ログテーブル → BigQuery へのバックフィル実装
#
# ## 内容
# Supabase（Postgres）のログテーブルを GCS 経由で BigQuery にバックフィルする。
# - frontend_event_logs
# - backend_event_logs
# - external_api_logs
#
# ## 前提
# - Supabase → GCS へのエクスポートは既存の GitHub Actions（pg-table-export.yml）で実行済み
# - GCS バケット上に CSV ファイルが配置されている
#
# ## 処理フロー
# 1. GCS から BigQuery ステージングテーブルへ CSV ロード（bq load）
# 2. BigQuery SQL 実行（ステージング作成 → レガシー作成 → INSERT → VIEW REPLACE）
#
# ## 使い方
#   ./20251203T0000_backfill_supabase_logs_to_bigquery.sh dev
#   ./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod
#
# ## 引数
#   ENV: dev または prod
#
# ## 注意
# - 実行前に GCS 上のエクスポートファイルが存在することを確認すること
# - ステージングテーブルは IF NOT EXISTS なので再実行可能
# - INSERT は冪等でないため、重複データを避けるには事前にステージングテーブルをクリアする必要あり
#

set -euo pipefail

print_usage() {
  sed -n '1,50p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

ENV="${1:-}"

if [[ -z "${ENV}" ]]; then
  echo "❌ 環境を指定してください: dev または prod" >&2
  echo
  print_usage
  exit 1
fi

# 共通設定
PROJECT_ID="food-scroll"

# 環境別設定
if [[ "${ENV}" == "dev" ]]; then
  DATASET_ID="nanitabeyo_logs_dev"
  GCS_FRONTEND_PATH="gs://food-scroll-logs-dev/supabase/frontend_event_logs.csv"
  GCS_BACKEND_PATH="gs://food-scroll-logs-dev/supabase/backend_event_logs.csv"
  GCS_EXTERNAL_PATH="gs://food-scroll-logs-dev/supabase/external_api_logs.csv"
elif [[ "${ENV}" == "prod" ]]; then
  DATASET_ID="nanitabeyo_logs_prod"
  GCS_FRONTEND_PATH="gs://food-scroll-logs-prod/supabase/frontend_event_logs.csv"
  GCS_BACKEND_PATH="gs://food-scroll-logs-prod/supabase/backend_event_logs.csv"
  GCS_EXTERNAL_PATH="gs://food-scroll-logs-prod/supabase/external_api_logs.csv"
else
  echo "❌ 不正な環境: ${ENV}" >&2
  echo "   dev または prod を指定してください。" >&2
  exit 1
fi

echo "▶️  ENV           : ${ENV}"
echo "▶️  PROJECT_ID    : ${PROJECT_ID}"
echo "▶️  DATASET_ID    : ${DATASET_ID}"
echo "────────────────────────────────────────────────────────"

# プロジェクト固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# ---------------------------------------------------------------------------
# 1) GCS → BigQuery ステージングテーブルへのロード
# ---------------------------------------------------------------------------

echo "📥 Step1: GCS から BigQuery ステージングテーブルへ CSV をロードします…"
echo

# 1-1. frontend_event_logs
echo "  - Loading ${GCS_FRONTEND_PATH} → ${DATASET_ID}.stg_frontend_event_logs"
bq load \
  --project_id="${PROJECT_ID}" \
  --source_format=CSV \
  --skip_leading_rows=1 \
  --allow_quoted_newlines \
  --allow_jagged_rows \
  --replace \
  "${DATASET_ID}.stg_frontend_event_logs" \
  "${GCS_FRONTEND_PATH}" \
  "id:STRING,user_id:STRING,event_name:STRING,error_level:STRING,path_name:STRING,payload:STRING,created_at:TIMESTAMP,created_app_version:STRING,created_commit_id:STRING"

echo "  ✅ frontend_event_logs ロード完了"
echo

# 1-2. backend_event_logs
echo "  - Loading ${GCS_BACKEND_PATH} → ${DATASET_ID}.stg_backend_event_logs"
bq load \
  --project_id="${PROJECT_ID}" \
  --source_format=CSV \
  --skip_leading_rows=1 \
  --allow_quoted_newlines \
  --allow_jagged_rows \
  --replace \
  "${DATASET_ID}.stg_backend_event_logs" \
  "${GCS_BACKEND_PATH}" \
  "id:STRING,event_name:STRING,error_level:STRING,function_name:STRING,user_id:STRING,payload:STRING,request_id:STRING,created_at:TIMESTAMP,created_commit_id:STRING"

echo "  ✅ backend_event_logs ロード完了"
echo

# 1-3. external_api_logs
echo "  - Loading ${GCS_EXTERNAL_PATH} → ${DATASET_ID}.stg_external_api_logs"
bq load \
  --project_id="${PROJECT_ID}" \
  --source_format=CSV \
  --skip_leading_rows=1 \
  --allow_quoted_newlines \
  --allow_jagged_rows \
  --replace \
  "${DATASET_ID}.stg_external_api_logs" \
  "${GCS_EXTERNAL_PATH}" \
  "id:STRING,request_id:STRING,function_name:STRING,api_name:STRING,endpoint:STRING,method:STRING,request_payload:STRING,response_payload:STRING,status_code:INT64,error_message:STRING,response_time_ms:INT64,user_id:STRING,created_at:TIMESTAMP,created_commit_id:STRING"

echo "  ✅ external_api_logs ロード完了"
echo

echo "✅ Step1: 全ての CSV ロードが完了しました。"
echo

# ---------------------------------------------------------------------------
# 2) BigQuery SQL 実行（ステージング → レガシー → VIEW）
# ---------------------------------------------------------------------------

echo "📊 Step2: BigQuery SQL を実行します（テーブル作成 / INSERT / VIEW REPLACE）…"
echo

SQL_FILE="./big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "❌ SQL ファイルが見つかりません: ${SQL_FILE}" >&2
  exit 1
fi

# ${DATASET} を実際の Dataset 名に置換してから bq query で実行
sed "s/\${DATASET}/${DATASET_ID}/g" "${SQL_FILE}" | bq query \
  --project_id="${PROJECT_ID}" \
  --use_legacy_sql=false \
  --quiet

echo "✅ Step2: BigQuery SQL の実行が完了しました。"
echo

# ---------------------------------------------------------------------------
# 3) 完了メッセージ
# ---------------------------------------------------------------------------

echo "🎉 バックフィル処理が完了しました。"
echo
echo "📌 作成されたリソース:"
echo "────────────────────────────────────────────────────────"
echo "【ステージングテーブル（Supabase 生データ）】"
echo "  - ${PROJECT_ID}.${DATASET_ID}.stg_frontend_event_logs"
echo "  - ${PROJECT_ID}.${DATASET_ID}.stg_backend_event_logs"
echo "  - ${PROJECT_ID}.${DATASET_ID}.stg_external_api_logs"
echo
echo "【レガシーテーブル（VIEW 互換スキーマ）】"
echo "  - ${PROJECT_ID}.${DATASET_ID}.frontend_event_logs_legacy"
echo "  - ${PROJECT_ID}.${DATASET_ID}.backend_event_logs_legacy"
echo "  - ${PROJECT_ID}.${DATASET_ID}.external_api_logs_legacy"
echo
echo "【VIEW（legacy + Cloud Logging raw の UNION ALL）】"
echo "  - ${PROJECT_ID}.${DATASET_ID}.frontend_event_logs"
echo "  - ${PROJECT_ID}.${DATASET_ID}.backend_event_logs"
echo "  - ${PROJECT_ID}.${DATASET_ID}.external_api_logs"
echo
echo "📌 次のステップ（手動実行）:"
echo "  1. BigQuery で frontend_event_logs_legacy の max(created_at) を取得"
echo "     例: SELECT MAX(created_at) FROM \`${PROJECT_ID}.${DATASET_ID}.frontend_event_logs_legacy\`"
echo
echo "  2. Supabase 側で max(created_at) 以前のデータのみ削除"
echo "     例: DELETE FROM frontend_event_logs WHERE created_at <= 'YYYY-MM-DD HH:MM:SS';"
echo
echo "  3. backend / external_api については全削除するか判断して適用"
echo
