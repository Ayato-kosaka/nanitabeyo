#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create_gas_dbro_writer.sh
# ------------------------------------------------------------------------------
# • Google Cloud CLI (gcloud) で実行する前提
# • “gas-dbro-writer” という Service Account を作成し、
#     - roles/storage.objectAdmin
#   を付与する。
# • JSON キーを生成して 文字列を echo 出力
#
# Best Practices
#  - set -euo pipefail：エラー即停止 & 変数未定義チェック
#  - PROJECT_ID は引数 or 環境変数（GOOGLE_CLOUD_PROJECT）で受け取る
#  - 既存 SA があればスキップして安全に再実行可
#  - キーファイルは trap で確実に削除
#
# 使い方:
#   chmod +x infra/gcp/create-gas-dbro-writer.sh
#   ./infra/gcp/create-gas-dbro-writer.sh your-gcp-project-id
# ------------------------------------------------------------------------------

set -euo pipefail

# ----- Config -----------------------------------------------------------------
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
SERVICE_ACCOUNT_NAME="gas-dbro-writer"
SERVICE_ACCOUNT_DESC="GAS DBRO Writer Service Account"
KEY_FILE="./${SERVICE_ACCOUNT_NAME}-key.json"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  echo "   使い方: $0 <GCP_PROJECT_ID>"
  exit 1
fi

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ----- Cleanup on Exit -------------------------------------------------------
cleanup() {
  rm -f "${KEY_FILE}"
}
trap cleanup EXIT

echo "▶️  プロジェクト: ${PROJECT_ID}"
echo "▶️  サービスアカウント: ${SERVICE_ACCOUNT_EMAIL}"
echo "───────────────────────────────────────────────"

# ----- 1. Enable required API (idempotent) -----------------------------------
echo "🔧 Enabling Cloud Storage API (if not already)…"
gcloud services enable storage.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# ----- 2. Create Service Account (if absent) ---------------------------------
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

# ----- 3. Bind Role -----------------------------------------------------------
echo "🔗 Binding IAM Role: roles/storage.objectAdmin…"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --quiet

# ----- 4. Create JSON Key ----------------------------------------------------
echo "🔑 Creating JSON key…"
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SERVICE_ACCOUNT_EMAIL}" \
  --project="${PROJECT_ID}" \
  --quiet

# ----- 5. Output JSON -------------------------------------------------------
# （GAS の環境変数登録などでそのまま貼り付けられるように）
cat "${KEY_FILE}"

# （trap で自動的に KEY_FILE を削除）
