#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create_api_dev_service_account.sh
# ------------------------------------------------------------------------------
# * Google Cloud CLI (gcloud) で実行する前提
# * “api-client-backend-dev” という Service Account を開発用に作成し、
#   - roles/secretmanager.secretAccessor
#   - roles/storage.objectAdmin
#   を付与する。
# * JSON キーを生成して Base64 文字列を echo 出力（CI/CD 変数登録などで便利）
#
# Best Practices
#  - set -euo pipefail：エラー即停止 & 変数未定義チェック
#  - PROJECT_ID は引数 or 環境変数（優先）で受け取る
#  - 既存 SA/Role がある場合はスキップして安全に再実行可
#  - キーファイルは trap で確実に削除
# 
# 使い方
# chmod +x infra/gcp/create_api_dev_service_account.sh
# ./infra/gcp/create_api_dev_service_account.sh your-gcp-project-id
# ------------------------------------------------------------------------------

set -euo pipefail

# ----- Config -----------------------------------------------------------------
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
SERVICE_ACCOUNT_NAME="api-client-backend-dev"
SERVICE_ACCOUNT_DESC="Backend API Client for development"
KEY_FILE="./${SERVICE_ACCOUNT_NAME}-key.json"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  echo "   使い方: ./create_api_dev_service_account.sh <GCP_PROJECT_ID>"
  exit 1
fi

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ----- Cleanup on Exit ---------------------------------------------------------
cleanup() {
  rm -f "${KEY_FILE}"
}
trap cleanup EXIT

echo "▶️  プロジェクト: ${PROJECT_ID}"
echo "▶️  サービスアカウント: ${SERVICE_ACCOUNT_EMAIL}"
echo "───────────────────────────────────────────────"

# ----- 1. Enable required APIs (idempotent) -----------------------------------
echo "🔧 Enabling IAM & Secret Manager APIs (if not enabled)…"
gcloud services enable \
  iam.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# ----- 2. Create Service Account (if absent) ----------------------------------
# ⚠️ **`… | grep -q` にしないこと（#2075）。** このスクリプトは `pipefail` で走る。
#    `grep -q` は最初の一致で即座に終わるので上流の `gcloud` が SIGPIPE で殺され、
#    `pipefail` が **その 141 をパイプライン全体の終了コードにする**。
#    ⚠️ **否定形（`! … | grep -q`）はもっと悪い。141 も «非ゼロ» なので `!` が true にし、
#    «既に在るものを無い» と判定して作りに行く**。`set -e` の下では次の作成が
#    「already exists」で落ちるので、このスクリプトが謳っている **冪等性が崩れる**。
#    だから **一度変数へ受けてから** `grep` する（#2075 で 141 を実測済み）。
existing_service_account="$(gcloud iam service-accounts list \
  --project="${PROJECT_ID}" \
  --filter="email=${SERVICE_ACCOUNT_EMAIL}" \
  --format="value(email)")"
if ! grep -q "${SERVICE_ACCOUNT_EMAIL}" <<< "${existing_service_account}"; then
  echo "✅ Creating Service Account…"
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
    --description="${SERVICE_ACCOUNT_DESC}" \
    --display-name="${SERVICE_ACCOUNT_DESC}" \
    --project="${PROJECT_ID}"
else
  echo "ℹ️  Service Account already exists. Skipping creation."
fi

# ----- 3. Bind Roles ----------------------------------------------------------
echo "🔗 Binding IAM Roles…"
for ROLE in roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="${ROLE}" \
    --quiet
done

# ----- 4. Create JSON Key -----------------------------------------------------
echo "🔑 Creating JSON Key…"
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SERVICE_ACCOUNT_EMAIL}" \
  --project="${PROJECT_ID}" \
  --quiet

# ----- 5. Output Base64 -------------------------------------------------------
echo "📦 Base64 Encoded Key ↓"
base64 --wrap=0 "${KEY_FILE}"
echo    # newline

echo "🎉  Done."
