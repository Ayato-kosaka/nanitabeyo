#!/usr/bin/env bash
# 変更チケット #427 Cloud CDN + GCS + expo-video における HLS 配信方式とルーティング見直し
#
# ## 内容
# - External HTTP(S) LB / Cloud CDN の URL Map に、
#   下記パスを GCS バックエンドバケットにルーティングするパスルールを追加する。
#
#   - https://cdn.nanitabeyo.net/development/transcoded-video/**
#   - https://cdn.nanitabeyo.net/production/transcoded-video/**
#
# - 既存の構成（default backend bucket = HLS 用 GCS バケット）を前提とし、
#   パスルール／host rule を明示的に追加するのみ。
#
# ## 背景
# - GCS バケットは public access prevention (PAP) 有効かつ private のままとし、
#   Cloud CDN / External HTTP(S) LB を public フロントとして利用する構成に変更。
# - HLS 配信用オブジェクトは `gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video/` に配置され、
#   Cloud CDN のオリジンとして GCS バケットを接続済み。
# - これまでは URL Map の default backend bucket のみを利用していたが、
#   今後は `cdn.nanitabeyo.net/{env}/transcoded-video/**` を明示的にルーティングして
#   パスベースでの配信パターンを固定したい。
#
# ## 対応
# - 対象ホスト:
#   - `cdn.nanitabeyo.net`
#
# - 対象パス:
#   - `/development/transcoded-video/*`
#   - `/production/transcoded-video/*`
#
# - 対象 URL Map / Backend Bucket:
#   - URL Map 名:          `cdn-url-map`
#   - Backend Bucket 名:   `backend-bucket-cdn`
#   - Path Matcher 名:     `cdn-transcoded-video-pm`
#
# - Up:
#   - 上記 URL Map に対して path matcher / host rule を追加する。
#   - 既に同名 path matcher / host rule が存在する場合は冪等にスキップ。
#
# - Down (rollback):
#   - `gcloud compute url-maps edit cdn-url-map` 等で、
#     `cdn-transcoded-video-pm` / `cdn.nanitabeyo.net` に紐づく pathRules を手動削除する。
#   - 本スクリプトでは Down を自動化せず、コメントのみ記載。
#
# =========================================
# 使い方
# =========================================
#   # デフォルトプロジェクトが food-scroll 等に設定済みであること:
#   gcloud config set project food-scroll
#
#   # Up 実行
#   ./20251116T1900_add_cdn_transcoded_video_path_rules.sh up
#
#   # Down（ロールバック）は手動:
#   #   gcloud compute url-maps edit cdn-url-map
#   #   → hostRules / pathMatchers から該当エントリを削除
#
# =========================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# --------------------------------------------------
# 設定値（必要に応じてプロジェクト固有に変更）
# --------------------------------------------------

CDN_HOST="cdn.nanitabeyo.net"
HOST_PREFIX="cdn"

URL_MAP_NAME="${HOST_PREFIX}-url-map"               # setup_cdn_signed_cookies_and_lb.sh と揃える
BACKEND_BUCKET_NAME="backend-bucket-${HOST_PREFIX}" # 同上（GCS バケットを指す backend bucket）
PATH_MATCHER_NAME="${HOST_PREFIX}-transcoded-video-pm"

# 対象パス
PATH_DEV="/development/transcoded-video/*"
PATH_PROD="/production/transcoded-video/*"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >&2
}

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} <up>

  up   : URL Map に対して、下記パスルールを追加します
         - https://${CDN_HOST}${PATH_DEV}
         - https://${CDN_HOST}${PATH_PROD}

※ Down (rollback) は自動化していません。必要な場合は:
   - gcloud compute url-maps edit ${URL_MAP_NAME}
   で hostRules / pathMatchers を手動で編集してください。
EOF
}

check_prerequisites() {
  if ! command -v gcloud >/dev/null 2>&1; then
    log "ERROR: gcloud が見つかりません。Cloud SDK をインストールしてください。"
    exit 1
  fi

  local project
  project="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -z "${project}" || "${project}" == "(unset)" ]]; then
    log "ERROR: gcloud のデフォルトプロジェクトが設定されていません。"
    log "       先に 'gcloud config set project <PROJECT_ID>' を実行してください。"
    exit 1
  fi
  log "INFO: gcloud project = ${project}"

  # URL Map が存在するかチェック
  if ! gcloud compute url-maps describe "${URL_MAP_NAME}" --global >/dev/null 2>&1; then
    log "ERROR: URL Map '${URL_MAP_NAME}' が存在しません。"
    log "       先に setup_cdn_signed_cookies_and_lb.sh 等で URL Map を作成してください。"
    exit 1
  fi

  # Backend Bucket が存在するかチェック
  if ! gcloud compute backend-buckets describe "${BACKEND_BUCKET_NAME}" >/dev/null 2>&1; then
    log "ERROR: Backend Bucket '${BACKEND_BUCKET_NAME}' が存在しません。"
    log "       setup_cdn_signed_cookies_and_lb.sh で作成済みであることを確認してください。"
    exit 1
  fi
}

confirm() {
  local msg="$1"
  read -r -p "${msg} [y/N]: " ans
  case "${ans}" in
    y|Y|yes|YES) return 0 ;;
    *)          return 1 ;;
  esac
}

up() {
  log "========================================="
  log " Up: /{env}/transcoded-video/* のパスルール追加を開始します"
  log " URL Map          : ${URL_MAP_NAME}"
  log " Backend Bucket   : ${BACKEND_BUCKET_NAME}"
  log " Path Matcher     : ${PATH_MATCHER_NAME}"
  log " Host (CDN)       : ${CDN_HOST}"
  log " 対象パス         :"
  log "   - ${PATH_DEV}"
  log "   - ${PATH_PROD}"
  log "========================================="

  # すでに同名 Path Matcher が存在するかチェック
  local existing_pms
  existing_pms="$(gcloud compute url-maps describe "${URL_MAP_NAME}" --global \
    --format="get(pathMatchers[].name)" 2>/dev/null || true)"

  if echo "${existing_pms}" | tr ';' '\n' | grep -qx "${PATH_MATCHER_NAME}"; then
    log "ℹ️  Path matcher '${PATH_MATCHER_NAME}' は既に存在します。"
    log "    本スクリプトでは再作成せず、そのまま利用します。"
  else
    log "➕ Path matcher '${PATH_MATCHER_NAME}' を追加します。"
    log "   - default-backend-bucket = ${BACKEND_BUCKET_NAME}"
    log "   - path-rules:"
    log "       ${PATH_DEV}  → ${BACKEND_BUCKET_NAME}"
    log "       ${PATH_PROD} → ${BACKEND_BUCKET_NAME}"

    if ! confirm "この path matcher を URL Map '${URL_MAP_NAME}' に追加してよいですか？"; then
      log "キャンセルされました。変更は行っていません。"
      exit 1
    fi

    gcloud compute url-maps add-path-matcher "${URL_MAP_NAME}" \
      --global \
      --path-matcher-name="${PATH_MATCHER_NAME}" \
      --default-backend-bucket="${BACKEND_BUCKET_NAME}" \
      --path-rules="${PATH_DEV}=${BACKEND_BUCKET_NAME},${PATH_PROD}=${BACKEND_BUCKET_NAME}" \
      --quiet

    log "✅ Path matcher '${PATH_MATCHER_NAME}' を追加しました。"
  fi

  # CDN_HOST に対する host rule の有無をチェック
  local host_rules
  host_rules="$(gcloud compute url-maps describe "${URL_MAP_NAME}" --global \
    --format="get(hostRules[].hosts)" 2>/dev/null || true)"

  if echo "${host_rules}" | tr ';,' '\n' | grep -qx "${CDN_HOST}"; then
    log "ℹ️  Host rule for '${CDN_HOST}' は既に存在します。追加しません。"
  else
    log "➕ Host rule を追加します: host='${CDN_HOST}' → pathMatcher='${PATH_MATCHER_NAME}'"

    if ! confirm "host rule を URL Map '${URL_MAP_NAME}' に追加してよいですか？"; then
      log "キャンセルされました。path matcher 追加済みの場合もそのまま残ります。"
      exit 1
    fi

    gcloud compute url-maps add-host-rule "${URL_MAP_NAME}" \
      --global \
      --hosts="${CDN_HOST}" \
      --path-matcher-name="${PATH_MATCHER_NAME}" \
      --quiet

    log "✅ Host rule を追加しました: ${CDN_HOST} → ${PATH_MATCHER_NAME}"
  fi

  log "-----------------------------------------"
  log "完了: 以下のパスが backend bucket '${BACKEND_BUCKET_NAME}' にルーティングされます:"
  log "  - https://${CDN_HOST}${PATH_DEV}"
  log "  - https://${CDN_HOST}${PATH_PROD}"
  log "-----------------------------------------"
  log "確認例:"
  log "  curl -I https://${CDN_HOST}/development/transcoded-video/path/to/master.m3u8"
  log "  curl -I https://${CDN_HOST}/production/transcoded-video/path/to/master.m3u8"
}

# Down は自動化せずコメントのみ
down_comment() {
  cat <<'EOC'
# =========================================
# Down (rollback) の考え方
# =========================================
# 本スクリプトは URL Map の構造変更を伴うため、
# 自動ロールバックは実装していません。
#
# ロールバック手順（手動）例:
#
#   1. URL Map をエディタで開く:
#      gcloud compute url-maps edit cdn-url-map --global
#
#   2. hostRules から、cdn.nanitabeyo.net に対応するエントリを削除 or 修正
#      例:
#        - hosts: [cdn.nanitabeyo.net]
#          pathMatcher: cdn-transcoded-video-pm
#
#   3. pathMatchers から、name: cdn-transcoded-video-pm に対応するエントリを削除
#
#   4. 保存して終了すると、URL Map が更新される。
#
# ※ URL Map に他の hostRules / pathMatchers がある場合、
#    それらを誤って変更しないよう注意してください。
EOC
}

main() {
  case "${1:-}" in
    up)
      check_prerequisites
      up
      ;;
    down)
      # 自動 rollback は実装せず、コメントだけ表示
      down_comment
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
