#!/usr/bin/env bash
#
# 変更チケット #427 Cloud CDN + GCS + expo-video における HLS 配信方式と認可方式の見直し
#
# ## 方針
# - `gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video/` 配下を
#   GCS 側で「本当に public (匿名 READ 可)」にする。
# - バケットレベルでは:
#   - Public Access Prevention (PAP) を解除
#   - uniform bucket-level access + 条件付き IAM で公開範囲を prefix 限定
#
# ## Up でやること
# 1. バケット `gs://nanitabeyo-private` の PAP を解除
#    - `gcloud storage buckets update gs://nanitabeyo-private --no-public-access-prevention`
# 2. IAM 条件付きロールで、
#    - member: allUsers
#    - role:   roles/storage.objectViewer
#    - condition: resource.name.startsWith("projects/_/buckets/nanitabeyo-private/objects/${ENVIRONMENT}/transcoded-video/")
#    を追加。
#
# ## Down でやること
# 1. 上記条件タイトルの IAM バインディングから allUsers を削除
# 2. 必要に応じて PAP を `enforced` に戻す（オプション・確認付き）
#
# =========================================
# 使い方
# =========================================
#   ENVIRONMENT=development ./20251116T1800_publish_transcoded_video_public.sh up
#   ENVIRONMENT=production  ./20251116T1800_publish_transcoded_video_public.sh up
#
#   ENVIRONMENT=development ./20251116T1800_publish_transcoded_video_public.sh down
#   ENVIRONMENT=production  ./20251116T1800_publish_transcoded_video_public.sh down
#
#   ENVIRONMENT 未指定時は `production` が利用される。
#

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

BUCKET_NAME="nanitabeyo-private"
BUCKET_URI="gs://${BUCKET_NAME}"

ENVIRONMENT="${ENVIRONMENT:-production}"
TARGET_PREFIX="${ENVIRONMENT}/transcoded-video/"
CONDITION_TITLE="public-transcoded-video-${ENVIRONMENT}"
CONDITION_DESCRIPTION="Public read for HLS transcoded video (${TARGET_PREFIX}) for allUsers"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >&2
}

usage() {
  cat <<EOF
Usage: ENVIRONMENT=<production|development> ${SCRIPT_NAME} <up|down>

  ENVIRONMENT  : 対象環境 (default: production)
                 - production
                 - development

  up   : PAP を解除し、\\${ENVIRONMENT}/transcoded-video/ 配下を allUsers に公開する。
  down : 上記の IAM 条件付きロールを削除し、必要なら PAP を戻す。

例:
  ENVIRONMENT=development ${SCRIPT_NAME} up
  ENVIRONMENT=production  ${SCRIPT_NAME} down
EOF
}

check_prerequisites() {
  if ! command -v gcloud >/dev/null 2>&1; then
    log "ERROR: gcloud が見つかりません。Cloud SDK をインストールしてください。"
    exit 1
  fi

  # 状態確認（abort はしない）
  local uba pap
  uba="$(gcloud storage buckets describe "${BUCKET_URI}" --format="value(uniform_bucket_level_access)" 2>/dev/null || true)"
  pap="$(gcloud storage buckets describe "${BUCKET_URI}" --format="value(public_access_prevention)" 2>/dev/null || true)"

  log "INFO: 現在のバケット設定 (${BUCKET_URI}):"
  log "      uniform_bucket_level_access = ${uba:-<unknown>}"
  log "      public_access_prevention   = ${pap:-<unknown>}"
}

confirm() {
  local msg="$1"
  read -r -p "${msg} [y/N]: " ans
  case "${ans}" in
    y|Y|yes|YES) return 0 ;;
    *)          return 1 ;;
  esac
}

disable_pap_if_needed() {
  local pap
  pap="$(gcloud storage buckets describe "${BUCKET_URI}" --format="value(public_access_prevention)" 2>/dev/null || true)"

  if [[ "${pap}" == "enforced" || "${pap}" == "inherited" ]]; then
    log "INFO: 現在 public_access_prevention=${pap} です。allUsers 公開のため PAP を解除する必要があります。"
    log "      コマンド: gcloud storage buckets update ${BUCKET_URI} --no-public-access-prevention"
    if confirm "PAP を解除してもよいですか？"; then
      gcloud storage buckets update "${BUCKET_URI}" --no-public-access-prevention
      log "INFO: PAP を解除しました。"
    else
      log "ERROR: PAP が有効なままでは allUsers を付与できないため中断します。"
      exit 1
    fi
  else
    log "INFO: public_access_prevention は ${pap:-<unset>} です。PAP 解除は不要と判断します。"
  fi
}

enable_pap_optionally() {
  if confirm "バケット ${BUCKET_URI} の PAP を 'enforced' に戻しますか？"; then
    log "INFO: PAP を enforced に戻します..."
    gcloud storage buckets update "${BUCKET_URI}" --public-access-prevention=enforced
    log "INFO: PAP を enforced に設定しました。"
  else
    log "INFO: PAP の状態は変更しませんでした。"
  fi
}

up() {
  log "========================================="
  log " Up: GCS 側で /${TARGET_PREFIX} を public にする処理を開始します"
  log " バケット : ${BUCKET_URI}"
  log " プレフィックス : ${TARGET_PREFIX}"
  log " 条件タイトル : ${CONDITION_TITLE}"
  log "========================================="

  # まず PAP を解除（必要なら）
  disable_pap_if_needed

  # 条件定義ファイルを一時生成
  local cond_file
  cond_file="$(mktemp)"
  cat > "${cond_file}" <<EOF
{
  "title": "${CONDITION_TITLE}",
  "description": "${CONDITION_DESCRIPTION}",
  "expression": "resource.name.startsWith(\\"projects/_/buckets/${BUCKET_NAME}/objects/${TARGET_PREFIX}\\")"
}
EOF

  log "以下の条件付き IAM バインディングを追加します:"
  log "  member     : allUsers"
  log "  role       : roles/storage.objectViewer"
  log "  expression : resource.name.startsWith(\"projects/_/buckets/${BUCKET_NAME}/objects/${TARGET_PREFIX}\")"
  log
  log "コマンド:"
  log "  gcloud storage buckets add-iam-policy-binding ${BUCKET_URI} \\"
  log "    --member=allUsers \\"
  log "    --role=roles/storage.objectViewer \\"
  log "    --condition-from-file=${cond_file}"

  if ! confirm "上記の IAM 変更を実行してよいですか？"; then
    log "キャンセルされました。"
    rm -f "${cond_file}"
    exit 1
  fi

  gcloud storage buckets add-iam-policy-binding "${BUCKET_URI}" \
    --member=allUsers \
    --role=roles/storage.objectViewer \
    --condition-from-file="${cond_file}"

  rm -f "${cond_file}"

  log "完了: ${BUCKET_URI} に条件付き IAM バインディングを追加しました。"
  log "      allUsers は ${TARGET_PREFIX} 配下のオブジェクトのみ READ 可能になります。"
}

down() {
  log "========================================="
  log " Down: 公開設定をロールバックします"
  log " バケット : ${BUCKET_URI}"
  log " プレフィックス : ${TARGET_PREFIX}"
  log " 条件タイトル : ${CONDITION_TITLE}"
  log "========================================="

  if ! confirm "本当に条件付き IAM バインディング（${CONDITION_TITLE}）を削除してよいですか？"; then
    log "キャンセルされました。"
    exit 1
  fi

  local tmp_policy tmp_policy_new
  tmp_policy="$(mktemp)"
  tmp_policy_new="$(mktemp)"

  log "現在の IAM ポリシーを取得中..."
  gcloud storage buckets get-iam-policy "${BUCKET_URI}" > "${tmp_policy}"

  log "条件タイトル '${CONDITION_TITLE}' かつ member=allUsers, role=roles/storage.objectViewer のバインディングを削除します..."

  python3 - "$tmp_policy" "$CONDITION_TITLE" > "${tmp_policy_new}" <<'PYCODE'
import json
import sys

policy_path = sys.argv[1]
condition_title = sys.argv[2]
member_to_remove = "allUsers"
role_to_match = "roles/storage.objectViewer"

with open(policy_path, "r", encoding="utf-8") as f:
    policy = json.load(f)

bindings = policy.get("bindings", [])
new_bindings = []

for b in bindings:
    role = b.get("role")
    members = b.get("members", [])
    cond = b.get("condition")

    if (
        role == role_to_match
        and member_to_remove in members
        and isinstance(cond, dict)
        and cond.get("title") == condition_title
    ):
        new_members = [m for m in members if m != member_to_remove]
        if new_members:
            b["members"] = new_members
            new_bindings.append(b)
    else:
        new_bindings.append(b)

policy["bindings"] = new_bindings
json.dump(policy, sys.stdout, indent=2, ensure_ascii=False)
PYCODE

  log "更新された IAM ポリシーを適用します..."
  gcloud storage buckets set-iam-policy "${BUCKET_URI}" "${tmp_policy_new}" >/dev/null

  rm -f "${tmp_policy}" "${tmp_policy_new}"

  log "完了: 条件タイトル '${CONDITION_TITLE}' の allUsers バインディングを削除しました。"

  # PAP を戻すかどうかはユーザに委ねる
  enable_pap_optionally
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
