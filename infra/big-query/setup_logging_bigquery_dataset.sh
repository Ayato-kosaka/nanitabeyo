#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_logging_bigquery_dataset.sh
# ------------------------------------------------------------------------------
# * 目的:
#   - BigQuery API を有効化
#   - BigQuery Dataset を作成（冪等）
#   - ロケーションを設定し、デフォルト table expiration を解除する
#
# 使い方:
#   chmod +x setup_logging_bigquery_dataset.sh
#   ./setup_logging_bigquery_dataset.sh <PROJECT_ID> <DATASET_ID> <REGION> <ENV>
#
# 例:
#   ./setup_logging_bigquery_dataset.sh food-scroll nanitabeyo_logs_dev asia-northeast1 dev
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

if [[ -z "${PROJECT_ID}" || -z "${DATASET_ID}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <DATASET_ID> <REGION> <ENV>"
  exit 1
fi

echo "▶️  PROJECT_ID   : ${PROJECT_ID}"
echo "▶️  DATASET_ID   : ${DATASET_ID}"
echo "▶️  REGION       : ${REGION}"
echo "▶️  ENV          : ${ENV}"
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
    --description="Logging dataset for ${ENV} environment" \
    "${DATASET_ID}"
  echo "✅ Dataset created."
fi

# --- 3) default table expiration を解除 ----------------------------------------
# BigQuery の dataset default table expiration は VIEW にも適用されるため、
# ログの保持期間には使用しない。保持期間が必要な場合は raw table の
# partition expiration を明示的に設定すること。
echo "🔄 Clearing Dataset default table expiration…"
bq update \
  --project_id="${PROJECT_ID}" \
  --default_table_expiration=0 \
  "${DATASET_ID}"
echo "✅ Dataset default table expiration cleared."

# --- 4) 動作チェックのための出力 ---------------------------------------------
echo ""
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "🔎 Quick verify:"
echo "   bq show --project_id=${PROJECT_ID} ${DATASET_ID}"
echo ""
echo "📌 Dataset details:"
bq show --project_id="${PROJECT_ID}" "${DATASET_ID}"
