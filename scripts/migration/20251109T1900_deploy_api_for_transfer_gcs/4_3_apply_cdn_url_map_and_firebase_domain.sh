#!/usr/bin/env bash
# 4_3_apply_cdn_url_map_and_firebase_domain.sh
# #414 【設計】GCS 新バケット移行時の CDN URL マップ反映 & Firebase Hosting カスタムドメイン追加の自動化漏れ対応
#
# 目的:
#   1. cdn.nanitabeyo.net 用 URL マップを infra/url-map/urlmap-cdn.nanitabeyo.net.yaml から import
#   2. Firebase Hosting サイト food-scroll に app.nanitabeyo.net カスタムドメインを追加
#
# 使い方:
#   ./4_3_apply_cdn_url_map_and_firebase_domain.sh
#
# 前提:
#   - 4_2_setup_private_cdn.sh が実行済み（CDN URL マップ cdn-url-map が存在）
#   - gcloud CLI ログイン済み
#   - infra/url-map/urlmap-cdn.nanitabeyo.net.yaml が最新の状態であること
#
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=develop
load_env
gcloud_check

# プロジェクトルートを取得
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
URL_MAP_YAML="${ROOT_DIR}/infra/url-map/urlmap-cdn.nanitabeyo.net.yaml"

# URL マップ YAML の存在確認
if [[ ! -f "${URL_MAP_YAML}" ]]; then
  err "URL map YAML not found: ${URL_MAP_YAML}"
  exit 1
fi

log "URL map YAML: ${URL_MAP_YAML}"

# 1. URL マップの検証（オプション：構文チェック）
log "Validating URL map configuration..."
if run_cmd gcloud compute url-maps validate --source="${URL_MAP_YAML}" 2>&1 | grep -q "is valid"; then
  ok "URL map YAML is valid"
else
  warn "URL map validation returned unexpected output (continuing anyway)"
fi

# 2. CDN URL マップを import（上書き更新）
# 既存の cdn-url-map が存在する場合でも上書き可能
log "Importing URL map: cdn-url-map from ${URL_MAP_YAML}"
run_cmd gcloud compute url-maps import cdn-url-map \
  --global \
  --source="${URL_MAP_YAML}" \
  --quiet

ok "URL map cdn-url-map imported successfully"

# 3. Firebase Hosting カスタムドメインの追加
# Firebase Hosting API v1beta1 を使用してカスタムドメインを追加
FIREBASE_PROJECT_ID="${PROJECT_ID}"
SITE_ID="food-scroll"
CUSTOM_DOMAIN="app.nanitabeyo.net"

log "Setting up custom domain for Firebase Hosting: ${CUSTOM_DOMAIN}"

# #414 【設計】Firebase Hosting カスタムドメイン追加を REST API 経由で自動化
# 既に存在する場合は 409 Conflict が返るが、これは冪等性として許容
ACCESS_TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  err "Failed to get access token from gcloud. Please ensure you are authenticated."
  exit 1
fi

log "Attempting to add custom domain via Firebase Hosting API..."

if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY_RUN] Would create custom domain: ${CUSTOM_DOMAIN} for site: ${SITE_ID}"
  ok "[DRY_RUN] Firebase custom domain setup simulated"
else
  # Firebase Hosting API を使用してカスタムドメインを追加
  # エンドポイント: POST /v1beta1/projects/{project}/sites/{site}/domains
  # 既に存在する場合は 409、成功時は 200/201 が返る
  HTTP_CODE=$(curl -s -o /tmp/firebase_domain_response.json -w "%{http_code}" -X POST \
    "https://firebasehosting.googleapis.com/v1beta1/projects/${FIREBASE_PROJECT_ID}/sites/${SITE_ID}/domains?domainId=${CUSTOM_DOMAIN}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Goog-User-Project: ${FIREBASE_PROJECT_ID}" \
    -d "{}" \
    2>&1)
  
  case ${HTTP_CODE} in
    200|201)
      ok "Custom domain ${CUSTOM_DOMAIN} created successfully for site ${SITE_ID}"
      if [[ -f /tmp/firebase_domain_response.json ]]; then
        log "Response: $(cat /tmp/firebase_domain_response.json)"
      fi
      ;;
    409)
      ok "Custom domain ${CUSTOM_DOMAIN} already exists (idempotent - no action needed)"
      ;;
    400|403|404)
      warn "Custom domain API returned HTTP ${HTTP_CODE}"
      if [[ -f /tmp/firebase_domain_response.json ]]; then
        warn "Response: $(cat /tmp/firebase_domain_response.json)"
      fi
      warn "Falling back to manual setup instructions below."
      ;;
    *)
      warn "Custom domain API returned unexpected HTTP ${HTTP_CODE}"
      if [[ -f /tmp/firebase_domain_response.json ]]; then
        warn "Response: $(cat /tmp/firebase_domain_response.json)"
      fi
      warn "Continuing with manual setup instructions..."
      ;;
  esac
  
  rm -f /tmp/firebase_domain_response.json
fi

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Firebase Hosting カスタムドメイン設定の次のステップ"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "カスタムドメインのセットアップを完了するには、DNS レコードの設定が必要です:"
echo ""
echo "1. Firebase Console で DNS レコードを確認:"
echo "   https://console.firebase.google.com/u/0/project/${FIREBASE_PROJECT_ID}/hosting/sites/${SITE_ID}"
echo ""
echo "2. Firebase が提示する DNS レコードを DNS プロバイダーに追加:"
echo "   - A レコード: ${CUSTOM_DOMAIN} → Firebase が提供する IP アドレス"
echo "   - または TXT レコード（ドメイン所有権の検証用）"
echo ""
echo "3. DNS 伝播を待機（通常 5 分〜1 時間、最大 24 時間）"
echo ""
echo "4. Firebase が自動的に:"
echo "   - ドメイン所有権を検証"
echo "   - SSL 証明書（Let's Encrypt）をプロビジョニング"
echo "   - HTTPS 配信を有効化"
echo ""
echo "5. 状態確認コマンド（オプション）:"
echo "   curl -s -H \"Authorization: Bearer \$(gcloud auth print-access-token)\" \\"
echo "     \"https://firebasehosting.googleapis.com/v1beta1/projects/${FIREBASE_PROJECT_ID}/sites/${SITE_ID}/domains/${CUSTOM_DOMAIN}\" \\"
echo "     | jq '.status'"
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ok "Script completed successfully. CDN URL map imported and Firebase custom domain setup initiated."
