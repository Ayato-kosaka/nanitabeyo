#!/usr/bin/env bash
# 4_3_apply_cdn_url_map_and_firebase_domain.sh
# #414 【設計】GCS 新バケット移行時の CDN URL マップ反映 & Firebase Hosting カスタムドメイン追加の自動化漏れ対応
#
# 目的:
#   1. cdn.nanitabeyo.net 用 URL マップを infra/url-map/urlmap-cdn.nanitabeyo.net.yaml から import
#   2. Firebase Hosting サイト food-scroll に app.nanitabeyo.net を UI で手動追加する手順を案内
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

# 3. Firebase Hosting カスタムドメインの手動設定を案内（API 自動化は中止）
FIREBASE_PROJECT_ID="${PROJECT_ID}"
SITE_ID="food-scroll"
CUSTOM_DOMAIN="app.nanitabeyo.net"

warn "Firebase Hosting カスタムドメインの自動追加は UI による手動実行に方針変更しました。"

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Firebase Hosting カスタムドメイン（UI で手動）手順"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Firebase Console を開く:"
echo "   https://console.firebase.google.com/u/0/project/${FIREBASE_PROJECT_ID}/hosting/sites/${SITE_ID}"
echo ""
echo "2. ［カスタムドメインを追加］をクリックし、次を入力:" 
echo "   ドメイン: ${CUSTOM_DOMAIN}"
echo ""
echo "3. 表示された DNS レコードを DNS プロバイダーに追加:" 
echo "   - A レコード: ${CUSTOM_DOMAIN} → Firebase が提供する IP" 
echo "   - （必要に応じて）TXT レコード: ドメイン所有権の検証用"
echo ""
echo "4. DNS 伝播を待機（通常 5 分〜1 時間、最大 24 時間）"
echo "   検証が完了すると SSL 証明書が自動プロビジョニングされ、HTTPS 配信が有効化されます。"
echo ""
echo "5. 状態確認（任意・読み取り専用 API）:"
echo "   curl -s -H \"Authorization: Bearer \$(gcloud auth print-access-token)\" \\\n     \"https://firebasehosting.googleapis.com/v1beta1/projects/${FIREBASE_PROJECT_ID}/sites/${SITE_ID}/domains/${CUSTOM_DOMAIN}\" \\\n     | jq '.status'"
echo ""

ok "Script completed. CDN URL map imported. Proceed with Firebase custom domain setup via UI."
