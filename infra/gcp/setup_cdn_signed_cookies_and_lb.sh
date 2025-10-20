#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_cdn_signed_cookies_and_lb.sh
# ------------------------------------------------------------------------------
# 目的:
#   - Cloud CDN（Signed Cookies 対応）+ HTTPS ロードバランサを作成
#   - バックエンドに Cloud Storage バケット（HLS 出力）を接続
#   - Signed Cookie 用シークレットを生成して LB に登録
#   - アプリが参照する .env 値 (CDN_HOST / CDN_KEY_NAME / CDN_KEY_SECRET_B64 / TTL) を出力
#
# 使い方:
#   chmod +x setup_cdn_signed_cookies_and_lb.sh
#   ./setup_cdn_signed_cookies_and_lb.sh <PROJECT_ID> <CDN_HOST> <OUTPUT_BUCKET> [KEY_NAME] [TTL_SECONDS]
#
# 引数:
#   PROJECT_ID     : GCP プロジェクト ID（例: food-scroll）
#   CDN_HOST       : 配信用の完全修飾ドメイン（例: cdn.example.com）
#   OUTPUT_BUCKET  : HLS 出力先の GCS バケット名（例: outputs-food-scroll）
#   KEY_NAME       : Signed URL/Cookie の KeyName（省略時: cdn-key-<日付>）
#   TTL_SECONDS    : Cookie の有効期限（秒）（省略時: 3600）
#
# 前提:
#   - gcloud CLI ログイン済み
#   - 実行ユーザーにプロジェクト/IAM/Compute/Storage 操作権限
#   - OUTPUT_BUCKET は存在していること（存在チェックのみ、本スクリプトでは作成しません）
#   - DNS 設定が管理可能なドメインを所有していること
#
# 作成する主要リソース（命名は変数化済み）:
#   - グローバル静的 IP
#   - マネージド SSL 証明書（CDN_HOST 用）
#   - Backend Bucket（Cloud CDN 有効）
#   - URL Map / Target HTTPS Proxy / Global Forwarding Rule (443)
#   - Signed URL Key（Backend Bucket に登録）
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等性: 既存ならスキップ/更新
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
CDN_HOST="${2:-}"
OUTPUT_BUCKET="${3:-}"
KEY_NAME_INPUT="${4:-}"
TTL_SECONDS="${5:-3600}"

if [[ -z "${PROJECT_ID}" || -z "${CDN_HOST}" || -z "${OUTPUT_BUCKET}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <CDN_HOST> <OUTPUT_BUCKET> [KEY_NAME] [TTL_SECONDS]"
  exit 1
fi

DATE_TAG="$(date +%Y%m%d-%H%M%S)"
KEY_NAME="${KEY_NAME_INPUT:-cdn-key-${DATE_TAG}}"

# リソース名
HOST_PREFIX="${CDN_HOST%%.*}"

IP_NAME="${HOST_PREFIX}-ip"
CERT_NAME="${HOST_PREFIX}-cert"
BACKEND_BUCKET_NAME="backend-bucket-${HOST_PREFIX}"
URL_MAP_NAME="${HOST_PREFIX}-url-map"
PROXY_NAME="${HOST_PREFIX}-https-proxy"
FWD_RULE_NAME="${HOST_PREFIX}-https-forwarding-rule"

echo "▶️  PROJECT_ID     : ${PROJECT_ID}"
echo "▶️  CDN_HOST       : ${CDN_HOST}"
echo "▶️  OUTPUT_BUCKET  : gs://${OUTPUT_BUCKET}"
echo "▶️  KEY_NAME       : ${KEY_NAME}"
echo "▶️  TTL_SECONDS    : ${TTL_SECONDS}"
echo "▶️  リソース名一覧:"
echo "   - Global IP            : ${IP_NAME}"
echo "   - SSL Certificate      : ${CERT_NAME}"
echo "   - Backend Bucket       : ${BACKEND_BUCKET_NAME}"
echo "   - URL Map              : ${URL_MAP_NAME}"
echo "   - Target HTTPS Proxy   : ${PROXY_NAME}"
echo "   - Forwarding Rule      : ${FWD_RULE_NAME}"
echo "────────────────────────────────────────────────────────"

gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 0) 必要な API を有効化 ---------------------------------------------------
echo "🔧 Enabling APIs (idempotent)…"
gcloud services enable \
  compute.googleapis.com \
  certificatemanager.googleapis.com \
  storage.googleapis.com \
  --quiet

# --- 1) バケット存在チェック ---------------------------------------------------
echo "🔎 Checking bucket existence…"
if ! gcloud storage buckets describe "gs://${OUTPUT_BUCKET}" >/dev/null 2>&1; then
  echo "❌ バケット gs://${OUTPUT_BUCKET} が見つかりません。先に作成してください。"
  exit 1
fi

# --- 2) グローバル静的 IP 予約 ------------------------------------------------
if ! gcloud compute addresses describe "${IP_NAME}" --global >/dev/null 2>&1; then
  echo "🌐 Creating global static IP: ${IP_NAME}"
  gcloud compute addresses create "${IP_NAME}" --global --quiet
else
  echo "ℹ️  Global static IP exists: ${IP_NAME}"
fi
IP_ADDRESS="$(gcloud compute addresses describe "${IP_NAME}" --global --format='value(address)')"
echo "   → ${IP_ADDRESS}"

# --- 3) マネージド SSL 証明書（CDN_HOST） -------------------------------------
#    DNS に A レコードで ${CDN_HOST} → ${IP_ADDRESS} を向ける必要があります。
if ! gcloud compute ssl-certificates describe "${CERT_NAME}" >/dev/null 2>&1; then
  echo "🔐 Creating managed SSL certificate: ${CERT_NAME}"
  gcloud compute ssl-certificates create "${CERT_NAME}" --domains="${CDN_HOST}" --quiet
else
  echo "ℹ️  SSL certificate exists: ${CERT_NAME}"
fi

# --- 4) Backend Bucket（Cloud CDN 有効） --------------------------------------
if ! gcloud compute backend-buckets describe "${BACKEND_BUCKET_NAME}" >/dev/null 2>&1; then
  echo "🪣 Creating backend bucket with Cloud CDN enabled: ${BACKEND_BUCKET_NAME}"
  gcloud compute backend-buckets create "${BACKEND_BUCKET_NAME}" \
    --gcs-bucket-name="${OUTPUT_BUCKET}" \
    --enable-cdn \
    --quiet
else
  echo "ℹ️  Backend bucket exists. Ensuring CDN is enabled."
  gcloud compute backend-buckets update "${BACKEND_BUCKET_NAME}" --enable-cdn --quiet
fi

# --- 4.5) Cloud CDN キャッシュフィル SA に GCS 読取を付与（バケットは非公開のまま） ----
echo "🔐 Granting Storage read to Cloud CDN fill service account (idempotent)…"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
CDN_FILL_SA="service-${PROJECT_NUMBER}@cloud-cdn-fill.iam.gserviceaccount.com"

# まだ SA が自動作成されていなくても問題ありません（IAM は先付け可）
gcloud storage buckets add-iam-policy-binding "gs://${OUTPUT_BUCKET}" \
  --member="serviceAccount:${CDN_FILL_SA}" \
  --role="roles/storage.objectViewer" \
  --quiet

echo "   → Granted roles/storage.objectViewer to ${CDN_FILL_SA} on gs://${OUTPUT_BUCKET}"

# --- 5) URL Map / HTTPS Proxy / Forwarding Rule -------------------------------
if ! gcloud compute url-maps describe "${URL_MAP_NAME}" >/dev/null 2>&1; then
  echo "🗺  Creating URL map: ${URL_MAP_NAME}"
  gcloud compute url-maps create "${URL_MAP_NAME}" \
    --default-backend-bucket="${BACKEND_BUCKET_NAME}" \
    --quiet
else
  echo "ℹ️  URL map exists: ${URL_MAP_NAME}"
fi

if ! gcloud compute target-https-proxies describe "${PROXY_NAME}" >/dev/null 2>&1; then
  echo "🧭 Creating target HTTPS proxy: ${PROXY_NAME}"
  gcloud compute target-https-proxies create "${PROXY_NAME}" \
    --url-map="${URL_MAP_NAME}" \
    --ssl-certificates="${CERT_NAME}" \
    --quiet
else
  echo "ℹ️  Target HTTPS proxy exists. Updating cert & URL map."
  gcloud compute target-https-proxies update "${PROXY_NAME}" \
    --url-map="${URL_MAP_NAME}" \
    --ssl-certificates="${CERT_NAME}" \
    --quiet
fi

if ! gcloud compute forwarding-rules describe "${FWD_RULE_NAME}" --global >/dev/null 2>&1; then
  echo "🚦 Creating global forwarding rule: ${FWD_RULE_NAME}"
  gcloud compute forwarding-rules create "${FWD_RULE_NAME}" \
    --address="${IP_NAME}" \
    --global \
    --target-https-proxy="${PROXY_NAME}" \
    --ports=443 \
    --quiet
else
  echo "ℹ️  Forwarding rule exists: ${FWD_RULE_NAME}"
fi

# --- 6) Signed Cookie 用の鍵を生成して登録 ------------------------------------
# 16バイトのRAW鍵を作り、標準base64（.env用）とbase64url（GCP登録用）を両方生成
RAW_BIN="$(mktemp)"
openssl rand 16 > "${RAW_BIN}"

CDN_KEY_SECRET_B64_STD="$(base64 < "${RAW_BIN}" | tr -d '\n')"                         # .env用
CDN_KEY_SECRET_B64URL="$(echo -n "${CDN_KEY_SECRET_B64_STD}" | tr '+/' '-_' | tr -d '=')" # GCP登録用

# 既存同名キーがあれば削除（冪等）
if gcloud compute backend-buckets describe "${BACKEND_BUCKET_NAME}" \
    --format="get(cdnPolicy.signedUrlKeyNames)" | grep -qw "${KEY_NAME}"; then
  echo "♻️  Removing existing signed-url key: ${KEY_NAME}"
  gcloud compute backend-buckets delete-signed-url-key "${BACKEND_BUCKET_NAME}" \
    --key-name="${KEY_NAME}" --quiet || true
fi

# base64url を key-file にして登録
TMP_KEY_FILE="$(mktemp)"
printf '%s' "${CDN_KEY_SECRET_B64URL}" > "${TMP_KEY_FILE}"
echo "🔑 Adding signed-url key: ${KEY_NAME}"
gcloud compute backend-buckets add-signed-url-key "${BACKEND_BUCKET_NAME}" \
  --key-name="${KEY_NAME}" \
  --key-file="${TMP_KEY_FILE}" \
  --quiet

rm -f "${TMP_KEY_FILE}" "${RAW_BIN}"

# --- 7) 動作に必要な情報の出力 -----------------------------------------------
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "📌 DNS 設定:  ${CDN_HOST} の A レコードを ${IP_ADDRESS} に向けてください。"
echo "   証明書の有効化には DNS 伝播後 数十分かかることがあります。"
echo ""
echo "🔎 確認コマンド（例）:"
echo "  curl -I https://${CDN_HOST}/path/to/your/hls/master.m3u8"
echo "  gcloud compute ssl-certificates describe cdn-cert   --format='value(managed.status,managed.domains,managed.domainStatus)'"
echo ""
echo "🧩 .env に追加（アプリ用）:"
cat <<ENV
CDN_HOST=${CDN_HOST}
CDN_KEY_NAME=${KEY_NAME}
CDN_KEY_SECRET_B64=${CDN_KEY_SECRET_B64_STD}
CDN_SIGNED_COOKIE_TTL_SECONDS=${TTL_SECONDS}
ENV
echo ""
echo "🧪 署名対象 prefix 例:"
echo "  https://${CDN_HOST}/prod/transcoded/dish_media/media_path/<recordId>/"
echo ""
echo "📝 メモ:"
echo " - 生成された鍵は LB の Backend Bucket に登録済みです（Cookie/URL 共用）。"
echo " - 鍵ローテーション時は新 KeyName を追加 → アプリの .env を切替 → 旧鍵を削除の順で。"
