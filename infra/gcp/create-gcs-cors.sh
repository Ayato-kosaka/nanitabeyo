#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create-gcs-cors.sh
# ------------------------------------------------------------------------------
# • 指定バケットに対して CORS 設定を適用するシェルスクリプト
# • CORS 設定は以下の内容で cors.json を生成して適用
#
#
# 使い方:
#   chmod +x create-gcs-cors.sh
#   ./create-gcs-cors.sh your-bucket-name
# ------------------------------------------------------------------------------

set -euo pipefail

BUCKET="${1:-${GCS_BUCKET:-}}"
CORS_FILE="cors.json"

if [[ -z "$BUCKET" ]]; then
  echo "❌ バケット名が指定されていません。"
  echo "   使い方: $0 <GCS_BUCKET_NAME>"
  exit 1
fi

# 終了時に cors.json を必ず削除
cleanup() {
  rm -f "$CORS_FILE"
}
trap cleanup EXIT

# cors.json を生成
cat > "$CORS_FILE" <<EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

echo "▶️  Applying CORS settings to gs://$BUCKET ..."
gsutil cors set "$CORS_FILE" "gs://$BUCKET"

echo "🎉  CORS 設定を適用しました: gs://$BUCKET"
