#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create_tasks_invoker_service_account.sh
# ------------------------------------------------------------------------------
# * Google Cloud CLI (gcloud) で実行する前提
# * Cloud Tasks 用のインフラを一括作成
#   - キュー "bulk-import-queue" の作成（冪等）
#   - "tasks-invoker" Service Account の作成
#   - Cloud Run サービスに invoker 権限付与
# * JSON キーを生成して Base64 文字列を echo 出力（CI/CD 変数登録などで便利）
#
# Best Practices
#  - set -euo pipefail：エラー即停止 & 変数未定義チェック
#  - PROJECT_ID は引数 or 環境変数（優先）で受け取る
#  - 既存リソースがある場合はスキップして安全に再実行可
#  - キーファイルは trap で確実に削除
# 
# 使い方
# chmod +x infra/gcp/create_tasks_invoker_service_account.sh
# ./infra/gcp/create_tasks_invoker_service_account.sh your-gcp-project-id asia-northeast1 your-cloud-run-url
# ------------------------------------------------------------------------------

set -euo pipefail

# ----- Config -----------------------------------------------------------------
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
TASKS_LOCATION="${2:-asia-northeast1}"
CLOUD_RUN_URL="${3:-}"
SERVICE_ACCOUNT_NAME="tasks-invoker"
SERVICE_ACCOUNT_DESC="Cloud Tasks Invoker for async job processing"
QUEUE_NAME="bulk-import-queue"
KEY_FILE="./${SERVICE_ACCOUNT_NAME}-key.json"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  echo "   使い方: ./create_tasks_invoker_service_account.sh <GCP_PROJECT_ID> [TASKS_LOCATION] [CLOUD_RUN_URL]"
  exit 1
fi

if [[ -z "${CLOUD_RUN_URL}" ]]; then
  echo "⚠️  CLOUD_RUN_URL が指定されていません。IAM権限のみ設定します。"
fi

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ----- Cleanup on Exit ---------------------------------------------------------
cleanup() {
  rm -f "${KEY_FILE}"
}
trap cleanup EXIT

echo "▶️  プロジェクト: ${PROJECT_ID}"
echo "▶️  サービスアカウント: ${SERVICE_ACCOUNT_EMAIL}"
echo "▶️  Tasks ロケーション: ${TASKS_LOCATION}"
echo "▶️  キュー名: ${QUEUE_NAME}"
echo "▶️  Cloud Run URL: ${CLOUD_RUN_URL:-'(未指定)'}"
echo "───────────────────────────────────────────────"

# ----- 1. Enable required APIs (idempotent) -----------------------------------
echo "🔧 Enabling Cloud Tasks & Cloud Run APIs (if not enabled)…"
gcloud services enable \
  cloudtasks.googleapis.com \
  run.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# ----- 2. Create Cloud Tasks Queue (if absent) --------------------------------
echo "📋 Creating Cloud Tasks Queue (if not exists)…"
if ! gcloud tasks queues describe "${QUEUE_NAME}" \
  --location="${TASKS_LOCATION}" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null 2>&1; then
  echo "✅ Creating queue: ${QUEUE_NAME}"
  gcloud tasks queues create "${QUEUE_NAME}" \
    --location="${TASKS_LOCATION}" \
    --project="${PROJECT_ID}" \
    --quiet
else
  echo "ℹ️  Queue already exists: ${QUEUE_NAME}. Skipping creation."
fi

# ----- 3. Create Service Account (if absent) ----------------------------------
if ! gcloud iam service-accounts list \
  --project="${PROJECT_ID}" \
  --filter="email=${SERVICE_ACCOUNT_EMAIL}" \
  --format="value(email)" | grep -q "${SERVICE_ACCOUNT_EMAIL}"; then
  echo "✅ Creating Service Account…"
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
    --description="${SERVICE_ACCOUNT_DESC}" \
    --display-name="${SERVICE_ACCOUNT_DESC}" \
    --project="${PROJECT_ID}"
else
  echo "ℹ️  Service Account already exists. Skipping creation."
fi

# ----- 4. Bind IAM Roles ------------------------------------------------------
echo "🔗 Binding IAM Roles…"
# Cloud Tasks に必要な権限
for ROLE in roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="${ROLE}" \
    --quiet
done

# Cloud Run への invoker 権限（CLOUD_RUN_URL が指定されている場合のみ）
if [[ -n "${CLOUD_RUN_URL}" ]]; then
  # Cloud Run サービス名を URL から抽出（簡略化）
  RUN_SERVICE_NAME=$(echo "${CLOUD_RUN_URL}" | sed -n 's|.*//\([^.]*\)\..*|\1|p')
  if [[ -n "${RUN_SERVICE_NAME}" ]]; then
    echo "🔗 Binding Cloud Run invoker role for service: ${RUN_SERVICE_NAME}"
    gcloud run services add-iam-policy-binding "${RUN_SERVICE_NAME}" \
      --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
      --role="roles/run.invoker" \
      --region="${TASKS_LOCATION}" \
      --project="${PROJECT_ID}" \
      --quiet || echo "⚠️  Cloud Run IAM binding failed. Service might not exist yet."
  fi
fi

# ----- 5. Create JSON Key -----------------------------------------------------
echo "🔑 Creating JSON Key…"
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SERVICE_ACCOUNT_EMAIL}" \
  --project="${PROJECT_ID}" \
  --quiet

# ----- 6. Output Base64 -------------------------------------------------------
echo "📦 Base64 Encoded Key ↓"
base64 --wrap=0 "${KEY_FILE}"
echo    # newline

echo "🎉  Cloud Tasks infrastructure setup completed."
echo ""
echo "🔧 Environment variables for your application:"
echo "GCP_PROJECT=${PROJECT_ID}"
echo "TASKS_LOCATION=${TASKS_LOCATION}"
echo "CLOUD_RUN_URL=${CLOUD_RUN_URL:-'<SET_YOUR_CLOUD_RUN_URL>'}"
echo "TASKS_INVOKER_SA=${SERVICE_ACCOUNT_EMAIL}"
echo ""
echo "📋 Next steps:"
echo "1. Set the above environment variables in your Cloud Run service"
echo "2. Deploy your application with the internal endpoints"
echo "3. Test the bulk import API to verify async processing works"