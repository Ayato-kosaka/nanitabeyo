#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create_google_api_key.sh
# ------------------------------------------------------------------------------
# • Google Cloud CLI (gcloud) で実行する前提
# • 指定プロジェクトに API Keys API を有効化し、
#   新しい標準 API キーを作成してキー文字列を標準出力に表示
#
# Best Practices
#  - set -euo pipefail：エラー即停止 & 変数未定義チェック
#  - PROJECT_ID は引数 or 環境変数（GOOGLE_CLOUD_PROJECT）で受け取る
#  - DISPLAY_NAME は第2引数で任意指定可
#
# 使い方:
#   chmod +x create_google_api_key.sh
#   ./create_google_api_key.sh your-gcp-project-id [optional-key-name]
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
KEY_NAME="${2:-\"API Key for ${PROJECT_ID}\"}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  echo "   使い方: $0 <GCP_PROJECT_ID> [KEY_DISPLAY_NAME]"
  exit 1
fi

echo "▶️  プロジェクト: ${PROJECT_ID}"
echo "▶️  キー名: ${KEY_NAME}"
echo "───────────────────────────────────────────────"

# 1. API Keys API を有効化 (まだ有効化されていない場合)
echo "🔧 Enabling API Keys API…"
gcloud services enable apikeys.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# 2. 新しい API キーを作成し、キー文字列のみを抽出
echo "🔑 Creating API key…"
API_KEY=$(
  gcloud services api-keys create \
    --project="${PROJECT_ID}" \
    --display-name="${KEY_NAME}" \
    --format="value(keyString)"
)

# 3. 出力
echo "🎉  Your new API Key:"
echo "${API_KEY}"
