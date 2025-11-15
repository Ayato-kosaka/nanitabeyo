#!/usr/bin/env bash

# 変更チケット #427 Cloud CDN + GCS + expo-video における HLS 配信方式と認可方式の見直し
#
# ## 内容
# - `gs://nanitabeyo-private/${env}/transcoded-video` 以下の HLS 配信用オブジェクトを
#   「公開前提（anonymous read 可）」にする。
# - 既存オブジェクトに対して、`AllUsers` へ READ 権限を付与する。
#
# ## 背景
# - 当初は master.m3u8 のみに署名付き URL を付ける構成を想定していたが、
#   HLS プレイヤーが派生 playlist / セグメントにクエリパラメータ（token）を
#   自動伝播しないことが判明した。
# - expo-video からは HLS セグメント取得ごとに署名を付け直すことができず、
#   master.m3u8 単体の署名では保護できない。
# - Cloud CDN の Signed URL / Signed Cookie も「パス prefix 単位の粗い制御」には向くものの、
#   Reels 的な「動画単位・ユーザ単位の細粒度 ACL」には適さない。
# - 上記を踏まえ、`gs://nanitabeyo-private/${'production' || 'development'}/transcoded-video`
#   以下のオブジェクトは公開前提で運用する方針とした。
#
# ## 対応
# - 対象パス: `gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video`
#   - ENVIRONMENT は `production` / `development` を想定。
#   - デフォルトは `production` とし、環境変数で上書き可能。
# - 対象 prefix 配下の **既存オブジェクト** に対して:
#   - `gsutil -m acl ch -r -u AllUsers:R gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video`
#     により匿名 READ を許可。
# - ※ 新規アップロード分については、アプリケーション側でアップロード時に
#   `-a public-read` 相当の ACL を付与する運用に変更すること。
#  （このスクリプトは既存オブジェクトの ACL 変更に限定）
#
# ## ロールバック
# - 再度 private 相当に戻したい場合は、対象 prefix 配下から `AllUsers` ACL を削除する:
#   - `gsutil -m acl ch -r -d AllUsers gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video`
# - 必要に応じて、アップロード運用（デフォルト ACL）も見直すこと。
#
# =========================================
# 使い方
# =========================================
#   ENVIRONMENT=development ./20251116T1200_publish_transcoded_video_public.sh up
#   ENVIRONMENT=production  ./20251116T1200_publish_transcoded_video_public.sh down
#
#   ENVIRONMENT 未指定時は `production` が利用される。
#

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

BUCKET_NAME="nanitabeyo-private"
ENVIRONMENT="${ENVIRONMENT:-production}"
TARGET_PREFIX="${ENVIRONMENT}/transcoded-video"
TARGET_URI="gs://${BUCKET_NAME}/${TARGET_PREFIX}"

log() {
  # 簡易ロガー
  # 出力例: [2025-11-16T12:00:00Z] message
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >&2
}

usage() {
  cat <<EOF
Usage: ENVIRONMENT=<production|development> ${SCRIPT_NAME} <up|down>

  ENVIRONMENT  : 対象環境 (default: production)
                 - production
                 - development

  up   : gs://${BUCKET_NAME}/\${ENVIRONMENT}/transcoded-video 配下の既存オブジェクトを
         公開読み取り (AllUsers:R) にする。
  down : 上記 prefix 配下から AllUsers ACL を削除し、private 相当に戻す。

例:
  ENVIRONMENT=development ${SCRIPT_NAME} up
  ENVIRONMENT=production  ${SCRIPT_NAME} down
EOF
}

check_prerequisites() {
  if ! command -v gsutil >/dev/null 2>&1; then
    log "ERROR: gsutil が見つかりません。gcloud SDK / gsutil をインストールしてください。"
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
  log " Up: 公開前提にする処理を開始します"
  log " 対象: ${TARGET_URI}"
  log "========================================="

  if ! gsutil ls "${TARGET_URI}" >/dev/null 2>&1; then
    log "WARNING: 対象パス ${TARGET_URI} にオブジェクトが存在しないか、バケット/パスが不正です。"
    log "WARNING: 続行するとエラーになる可能性があります。"
    if ! confirm "それでも続行しますか？"; then
      log "中断しました。"
      exit 1
    fi
  fi

  log "AllUsers:R ACL を付与します（既存オブジェクトに対して再帰的に適用）..."
  log "コマンド: gsutil -m acl ch -r -u AllUsers:R ${TARGET_URI}"

  if confirm "上記のコマンドを実行してよいですか？"; then
    gsutil -m acl ch -r -u AllUsers:R "${TARGET_URI}"
    log "完了: ${TARGET_URI} 配下の既存オブジェクトに AllUsers:R を付与しました。"
  else
    log "キャンセルされました。変更は行っていません。"
    exit 1
  fi

  log "補足: 新規アップロード分については、アプリケーション側で public-read 相当の ACL を付与してください。"
}

down() {
  log "========================================="
  log " Down: 公開設定をロールバックします"
  log " 対象: ${TARGET_URI}"
  log "========================================="

  if ! gsutil ls "${TARGET_URI}" >/dev/null 2>&1; then
    log "WARNING: 対象パス ${TARGET_URI} にオブジェクトが存在しないか、バケット/パスが不正です。"
    if ! confirm "それでも続行しますか？"; then
      log "中断しました。"
      exit 1
    fi
  fi

  log "AllUsers ACL を削除します（既存オブジェクトに対して再帰的に適用）..."
  log "コマンド: gsutil -m acl ch -r -d AllUsers ${TARGET_URI}"

  if confirm "上記のコマンドを実行してよいですか？"; then
    gsutil -m acl ch -r -d AllUsers "${TARGET_URI}"
    log "完了: ${TARGET_URI} 配下から AllUsers ACL を削除しました。"
  else
    log "キャンセルされました。変更は行っていません。"
    exit 1
  fi

  log "補足: アップロード運用（デフォルト ACL）が public-read のままの場合、"
  log "      今後アップロードされるオブジェクトは引き続き公開されます。必要に応じて運用も見直してください。"
}

main() {
  if [[ "${1:-}" == "" ]]; then
    usage
    exit 1
  fi

  local cmd="$1"

  check_prerequisites

  case "${cmd}" in
    up)
      up
      ;;
    down)
      down
      ;;
    *)
      log "ERROR: 不明なコマンドです: ${cmd}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
