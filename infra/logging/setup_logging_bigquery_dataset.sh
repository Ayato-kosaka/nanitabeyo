#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_logging_bigquery_dataset.sh
# ------------------------------------------------------------------------------
# * 目的:
#   - BigQuery API を有効化
#   - BigQuery Dataset を作成（冪等）
#   - ロケーション / デフォルト TTL を設定
#
# 使い方:
#   chmod +x setup_logging_bigquery_dataset.sh
#   ./setup_logging_bigquery_dataset.sh <PROJECT_ID> <DATASET_ID> <REGION> <ENV> <TTL_DAYS>
#
# 例:
#   ./setup_logging_bigquery_dataset.sh food-scroll nanitabeyo_logs_dev asia-northeast1 dev 90
#
# 必要条件:
#   - gcloud CLI がログイン済み
#   - 実行ユーザに BigQuery 管理権限
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等 & 判定ガード
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
DATASET_ID="${2:-}"
REGION="${3:-asia-northeast1}"
ENV="${4:-dev}"
TTL_DAYS="${5:-90}"

if [[ -z "${PROJECT_ID}" || -z "${DATASET_ID}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <DATASET_ID> <REGION> <ENV> <TTL_DAYS>"
  exit 1
fi

# TTL を秒に変換
TTL_SECONDS=$((TTL_DAYS * 86400))

echo "▶️  PROJECT_ID   : ${PROJECT_ID}"
echo "▶️  DATASET_ID   : ${DATASET_ID}"
echo "▶️  REGION       : ${REGION}"
echo "▶️  ENV          : ${ENV}"
echo "▶️  TTL_DAYS     : ${TTL_DAYS}"
echo "▶️  TTL_SECONDS  : ${TTL_SECONDS}"
echo "────────────────────────────────────────────────────────"

# プロジェクトを固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1) BigQuery API 有効化（冪等） ------------------------------------------
echo "🔧 Enabling BigQuery API (idempotent)…"
gcloud services enable bigquery.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# --- 2) Dataset 存在チェック & 作成（冪等） -----------------------------------
echo "📌 Creating BigQuery Dataset: ${DATASET_ID}…"

if bq show --project_id="${PROJECT_ID}" "${DATASET_ID}" >/dev/null 2>&1; then
  echo "ℹ️  Dataset already exists. Skipping creation."
else
  bq --location="${REGION}" mk \
    --project_id="${PROJECT_ID}" \
    --dataset \
    --default_table_expiration="${TTL_SECONDS}" \
    --description="Logging dataset for ${ENV} environment (TTL: ${TTL_DAYS} days)" \
    "${DATASET_ID}"
  echo "✅ Dataset created."
fi

# --- 3) Dataset の TTL 設定を更新（既存の場合も TTL を適用） -------------------
echo "🔄 Updating Dataset default table expiration…"
bq update \
  --project_id="${PROJECT_ID}" \
  --default_table_expiration="${TTL_SECONDS}" \
  "${DATASET_ID}"
echo "✅ Dataset TTL updated to ${TTL_DAYS} days."

# --- 4) 動作チェックのための出力 ---------------------------------------------
echo ""
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "🔎 Quick verify:"
echo "   bq show --project_id=${PROJECT_ID} ${DATASET_ID}"
echo ""
echo "📌 Dataset details:"
bq show --project_id="${PROJECT_ID}" "${DATASET_ID}"
