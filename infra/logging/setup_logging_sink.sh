#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_logging_sink.sh
# ------------------------------------------------------------------------------
# * 目的:
#   - Cloud Logging API を有効化
#   - Cloud Logging Sink を作成 / 更新（冪等）
#   - Sink の writerIdentity に対して BigQuery への IAM 権限を付与
#
# 使い方:
#   chmod +x setup_logging_sink.sh
#   ./setup_logging_sink.sh <PROJECT_ID> <DATASET_ID> <SINK_NAME> <FILTER>
#
# 例:
#   ./setup_logging_sink.sh food-scroll nanitabeyo_logs_dev logs-to-bq-dev \
#     'resource.type="cloud_run_revision" jsonPayload.log_type="frontend_event_logs"'
#
# 必要条件:
#   - gcloud CLI がログイン済み
#   - 実行ユーザに Cloud Logging 管理権限 / BigQuery IAM 変更権限
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等 & 判定ガード
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
DATASET_ID="${2:-}"
SINK_NAME="${3:-}"
FILTER="${4:-}"

if [[ -z "${PROJECT_ID}" || -z "${DATASET_ID}" || -z "${SINK_NAME}" || -z "${FILTER}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <DATASET_ID> <SINK_NAME> <FILTER>"
  exit 1
fi

DESTINATION="bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/${DATASET_ID}"

echo "▶️  PROJECT_ID   : ${PROJECT_ID}"
echo "▶️  DATASET_ID   : ${DATASET_ID}"
echo "▶️  SINK_NAME    : ${SINK_NAME}"
echo "▶️  DESTINATION  : ${DESTINATION}"
echo "▶️  FILTER       : ${FILTER}"
echo "────────────────────────────────────────────────────────"

# プロジェクトを固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1) Cloud Logging API 有効化（冪等） -------------------------------------
echo "🔧 Enabling Cloud Logging API (idempotent)…"
gcloud services enable logging.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# --- 2) Sink 存在チェック & 作成/更新（冪等） ---------------------------------
echo "📌 Creating/Updating Cloud Logging Sink: ${SINK_NAME}…"

if gcloud logging sinks describe "${SINK_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "ℹ️  Sink already exists. Updating…"
  gcloud logging sinks update "${SINK_NAME}" \
    "${DESTINATION}" \
    --project="${PROJECT_ID}" \
    --log-filter="${FILTER}" \
    --use-partitioned-tables \
    --quiet
  echo "✅ Sink updated."
else
  gcloud logging sinks create "${SINK_NAME}" \
    "${DESTINATION}" \
    --project="${PROJECT_ID}" \
    --log-filter="${FILTER}" \
    --use-partitioned-tables \
    --quiet
  echo "✅ Sink created."
fi

# --- 3) Sink の writerIdentity を取得 -----------------------------------------
echo "🔑 Retrieving Sink writerIdentity…"
WRITER_IDENTITY=$(gcloud logging sinks describe "${SINK_NAME}" \
  --project="${PROJECT_ID}" \
  --format='value(writerIdentity)')

echo "ℹ️  Writer Identity: ${WRITER_IDENTITY}"

# --- 4) BigQuery Dataset に IAM 権限付与 -------------------------------------
echo "🔗 Granting BigQuery dataEditor role to Sink writer (project-level)…"

# writerIdentity から serviceAccount: プレフィックスを取得
# 形式: serviceAccount:p386582543095-xxxxxx@gcp-sa-logging.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${WRITER_IDENTITY}" \
  --role="roles/bigquery.dataEditor" \
  --quiet

echo "✅ IAM binding added to project: ${PROJECT_ID} (roles/bigquery.dataEditor)"


# --- 5) 動作チェックのための出力 ---------------------------------------------
echo ""
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "🔎 Quick verify:"
echo "   gcloud logging sinks describe ${SINK_NAME} --project=${PROJECT_ID}"
echo ""
echo "📌 Sink details:"
gcloud logging sinks describe "${SINK_NAME}" --project="${PROJECT_ID}"
