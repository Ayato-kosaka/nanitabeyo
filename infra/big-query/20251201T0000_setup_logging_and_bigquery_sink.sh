#!/usr/bin/env bash

# 変更チケット #487 Cloud Logging / BigQuery ログ基盤セットアップ（dev / prod）
#
# ## 内容
# - Cloud Logging → BigQuery Sink を dev / prod 環境で構築する。
# - BigQuery Dataset（nanitabeyo_logs_dev / nanitabeyo_logs_prod）を作成する。
#   ※ VIEW 作成は本スクリプトの対象外
#
# ## 対象スクリプト
# - infra/big-query/setup_logging_bigquery_dataset.sh
# - infra/big-query/setup_logging_sink.sh
#   ※ VIEW 作成用 SQL は別管理
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
# - Dataset の default table expiration は設定しない。
#   ログ保持期間が必要な場合は、Cloud Logging Sink の raw table に
#   partition expiration を明示設定する。
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
#   - 実行場所は infra/big-query ディレクトリを想定
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

  echo "🔧 Step1 (${env_name}): setup_logging_bigquery_dataset.sh を実行します…"
  echo "  - DATASET   : ${dataset_id}"
  echo

  ./setup_logging_bigquery_dataset.sh \
    "${PROJECT_ID}" \
    "${dataset_id}" \
    "${REGION}" \
    "${env_name}"

  echo "✅ ${env_name}: BigQuery Dataset setup 完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_dataset_setup "dev" "${DATASET_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_dataset_setup "prod" "${DATASET_PROD}"
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
# 3) 完了メッセージ
# ---------------------------------------------------------------------------

echo "🎉 全ての処理が完了しました。"
echo
echo "📌 作成されたリソース:"
echo "────────────────────────────────────────────────────────"
if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  echo "【dev 環境】"
  echo "  - Dataset: ${PROJECT_ID}.${DATASET_DEV}"
  echo "  - Sink   : ${SINK_NAME_DEV}"
  echo
fi
if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  echo "【prod 環境】"
  echo "  - Dataset: ${PROJECT_ID}.${DATASET_PROD}"
  echo "  - Sink   : ${SINK_NAME_PROD}"
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

exit 0
