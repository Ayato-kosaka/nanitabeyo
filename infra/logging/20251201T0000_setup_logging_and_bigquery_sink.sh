#!/usr/bin/env bash

# 変更チケット #487 Cloud Logging / BigQuery ログ基盤セットアップ（dev / prod）
#
# ## 内容
# - Cloud Logging → BigQuery Sink を dev / prod 環境で構築する。
# - BigQuery Dataset（nanitabeyo_logs_dev / nanitabeyo_logs_prod）を作成する。
# - Supabase 互換スキーマの VIEW を作成する。
#
# ## 対象スクリプト
# - infra/logging/setup_logging_bigquery_dataset.sh
# - infra/logging/setup_logging_sink.sh
# - infra/logging/big-query/migration/20251201T0000_create_log_views.sql
#
# ## 背景
# - Supabase 上のログテーブル（frontend_event_logs, backend_event_logs, external_api_logs）を
#   BigQuery に移行するための基盤を整備する。
# - Cloud Logging に一旦集約 → BigQuery Sink で転送する方式を採用。
#
# ## 構成
# - プロジェクト: food-scroll
# - リージョン : asia-northeast1
# - Dataset:
#     dev : nanitabeyo_logs_dev
#     prod: nanitabeyo_logs_prod
# - Sink:
#     dev : logs-to-bq-dev
#     prod: logs-to-bq-prod
# - TTL:
#     dev : 90日
#     prod: 730日（2年）
#
# ## ロールバック
# - Dataset / Sink を個別に削除する（自動ロールバックは提供しない）。
#
# ## 使い方
#   # dev / prod 両方まとめて実行
#   ./20251201T0000_setup_logging_and_bigquery_sink.sh all
#
#   # dev 環境のみ
#   ./20251201T0000_setup_logging_and_bigquery_sink.sh dev
#
#   # prod 環境のみ
#   ./20251201T0000_setup_logging_and_bigquery_sink.sh prod
#
# ※ 注意:
#   - 実行場所は infra/logging ディレクトリを想定
#   - gcloud にログイン済みであること
#   - 各スクリプトは冪等なコマンドで構成しているため、
#     既に一部適用済みでも再実行して問題ない想定
#

set -euo pipefail

print_usage() {
  sed -n '1,140p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-all}"

case "${MODE}" in
  all|dev|prod)
    ;;
  *)
    echo "MODE が不正です: ${MODE}" >&2
    echo "all / dev / prod のいずれかを指定してください。" >&2
    echo
    print_usage
    exit 1
    ;;
esac

# 共通設定
PROJECT_ID="food-scroll"
REGION="asia-northeast1"

# 環境ごとの Dataset 名
DATASET_DEV="nanitabeyo_logs_dev"
DATASET_PROD="nanitabeyo_logs_prod"

# 環境ごとの Sink 名
SINK_NAME_DEV="logs-to-bq-dev"
SINK_NAME_PROD="logs-to-bq-prod"

# TTL 設定（日数）
TTL_DAYS_DEV="90"
TTL_DAYS_PROD="730"

# Sink フィルタ
# jsonPayload.log_type ベースでフィルタリング（NestJS stdout JSON 出力に対応）（環境別）
SINK_FILTER_DEV='resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-development"
  AND (jsonPayload.log_type="backend_event_logs"
       OR jsonPayload.log_type="frontend_event_logs"
       OR jsonPayload.log_type="external_api_logs")'

SINK_FILTER_PROD='resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND (jsonPayload.log_type="backend_event_logs"
       OR jsonPayload.log_type="frontend_event_logs"
       OR jsonPayload.log_type="external_api_logs")'

echo "▶️  MODE           : ${MODE}"
echo "▶️  PROJECT_ID     : ${PROJECT_ID}"
echo "▶️  REGION         : ${REGION}"
echo "▶️  DATASET_DEV    : ${DATASET_DEV}"
echo "▶️  DATASET_PROD   : ${DATASET_PROD}"
echo "▶️  SINK_NAME_DEV  : ${SINK_NAME_DEV}"
echo "▶️  SINK_NAME_PROD : ${SINK_NAME_PROD}"
echo "────────────────────────────────────────────────────────"

# プロジェクト固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# ---------------------------------------------------------------------------
# 1) BigQuery Dataset セットアップ
# ---------------------------------------------------------------------------

run_dataset_setup() {
  local env_name="$1"
  local dataset_id="$2"
  local ttl_days="$3"

  echo "🔧 Step1 (${env_name}): setup_logging_bigquery_dataset.sh を実行します…"
  echo "  - DATASET   : ${dataset_id}"
  echo "  - TTL (days): ${ttl_days}"
  echo

  ./setup_logging_bigquery_dataset.sh \
    "${PROJECT_ID}" \
    "${dataset_id}" \
    "${REGION}" \
    "${env_name}" \
    "${ttl_days}"

  echo "✅ ${env_name}: BigQuery Dataset setup 完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_dataset_setup "dev" "${DATASET_DEV}" "${TTL_DAYS_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_dataset_setup "prod" "${DATASET_PROD}" "${TTL_DAYS_PROD}"
fi

# ---------------------------------------------------------------------------
# 2) Cloud Logging Sink セットアップ
# ---------------------------------------------------------------------------

run_sink_setup() {
  local env_name="$1"
  local dataset_id="$2"
  local sink_name="$3"
  local sink_filter="$4"

  echo "🔗 Step2 (${env_name}): setup_logging_sink.sh を実行します…"
  echo "  - SINK_NAME : ${sink_name}"
  echo "  - DATASET   : ${dataset_id}"
  echo "  - FILTER    : ${sink_filter}"
  echo

  ./setup_logging_sink.sh \
    "${PROJECT_ID}" \
    "${dataset_id}" \
    "${sink_name}" \
    "${sink_filter}"

  echo "✅ ${env_name}: Cloud Logging Sink setup 完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_sink_setup "dev" "${DATASET_DEV}" "${SINK_NAME_DEV}" "${SINK_FILTER_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_sink_setup "prod" "${DATASET_PROD}" "${SINK_NAME_PROD}" "${SINK_FILTER_PROD}"
fi

# ---------------------------------------------------------------------------
# 3) BigQuery VIEW 作成
# ---------------------------------------------------------------------------

run_view_creation() {
  local env_name="$1"
  local dataset_id="$2"

  echo "📊 Step3 (${env_name}): BigQuery VIEW を作成します…"
  echo "  - DATASET : ${dataset_id}"
  echo

  # SQL ファイルから VIEW を作成
  # Dataset を置換してから bq query で実行
  local sql_file="./big-query/migration/20251201T0000_create_log_views.sql"

  if [[ ! -f "${sql_file}" ]]; then
    echo "❌ SQL ファイルが見つかりません: ${sql_file}"
    exit 1
  fi

  # DATASET_PLACEHOLDER を実際の Dataset 名に置換して実行
  sed "s/\${DATASET}/${dataset_id}/g" "${sql_file}" | bq query \
    --project_id="${PROJECT_ID}" \
    --use_legacy_sql=false \
    --quiet

  echo "✅ ${env_name}: BigQuery VIEW 作成完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_view_creation "dev" "${DATASET_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_view_creation "prod" "${DATASET_PROD}"
fi

# ---------------------------------------------------------------------------
# 4) 完了メッセージ
# ---------------------------------------------------------------------------

echo "🎉 全ての処理が完了しました。"
echo
echo "📌 作成されたリソース:"
echo "────────────────────────────────────────────────────────"
if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  echo "【dev 環境】"
  echo "  - Dataset: ${PROJECT_ID}.${DATASET_DEV}"
  echo "  - Sink   : ${SINK_NAME_DEV}"
  echo "  - VIEWs  : frontend_event_logs, backend_event_logs, external_api_logs"
  echo
fi
if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  echo "【prod 環境】"
  echo "  - Dataset: ${PROJECT_ID}.${DATASET_PROD}"
  echo "  - Sink   : ${SINK_NAME_PROD}"
  echo "  - VIEWs  : frontend_event_logs, backend_event_logs, external_api_logs"
  echo
fi
echo "📌 ログ出力の確認:"
echo "  Cloud Run から stdout に JSON ログを出力すると、"
echo "  Cloud Logging → BigQuery に自動転送されます。"
echo
echo "📌 NestJS / Cloud Run からのログ出力形式:"
echo "  stdout に JSON を出力し、jsonPayload.log_type でログ種別を識別"
cat <<LOG
  jsonPayload.log_type の値:
    - "backend_event_logs"
    - "frontend_event_logs"
    - "external_api_logs"

  logName（参考）:
    - projects/food-scroll/logs/stdout
    ※ Cloud Run からの stdout ログは自動的に logName が割り当てられる
LOG
