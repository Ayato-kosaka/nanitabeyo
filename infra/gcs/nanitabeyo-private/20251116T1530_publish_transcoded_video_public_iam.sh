#!/usr/bin/env bash
# 20251116T1530_publish_transcoded_video_public_iam.sh
#
# 変更チケット #??? Cloud CDN + GCS + expo-video における HLS 配信方式と認可方式の見直し
#
# ## 内容
# - `gs://nanitabeyo-private/${ENVIRONMENT}/transcoded-video/` 配下のオブジェクトを
#   IAM 条件付きロールで「匿名 READ 可 (allUsers)」にする。
# - 既存オブジェクトの ACL には触れず、bucket-level IAM のみを編集する。
#
# ## 背景
# - 当初は `gsutil acl ch -u AllUsers:R` を使って prefix 配下のオブジェクト ACL を書き換えていたが、
#   一部オブジェクトに対して OWNER ロールがなく、ACL 更新に失敗した。
# - また、最近の GCS では「ACL より IAM」を推奨しており、uniform bucket-level access を有効にすると
#   そもそも ACL ベースの制御ができない。
# - そこで、`allUsers` + `roles/storage.objectViewer` を **条件付き IAM** で付与し、
#   `${ENVIRONMENT}/transcoded-video/` 以下のみ公開とする方針に変更する。
#
# ## 対応
# - 対象バケット: `gs://nanitabeyo-private`
# - 対象 logical prefix:
#   - `projects/_/buckets/nanitabeyo-private/objects/${ENVIRONMENT}/transcoded-video/`
# - Up:
#   - `gcloud storage buckets add-iam-policy-binding` を利用し、
#     `allUsers` に `roles/storage.objectViewer` を付与（条件付き）。
# - Down:
#   - バケットの IAM ポリシーを取得し、
#     上記条件（title: public-transcoded-video-${ENVIRONMENT}）のバインディングだけを削除して戻す。
#
# ## ロールバック
# - `./20251116T1530_publish_transcoded_video_public_iam.sh down` を実行すると、
#   該当の条件付きバインディングのみを IAM ポリシーから削除する。
#
# =========================================
# 使い方
# =========================================
#   ENVIRONMENT=development ./20251116T1530_publish_transcoded_video_public_iam.sh up
#   ENVIRONMENT=production  ./20251116T1530_publish_transcoded_video_public_iam.sh up
#
#   ENVIRONMENT=development ./20251116T1530_publish_transcoded_video_public_iam.sh down
#   ENVIRONMENT=production  ./20251116T1530_publish_transcoded_video_public_iam.sh down
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

  up   : IAM 条件付きロールで \${ENVIRONMENT}/transcoded-video/ 配下を allUsers に公開する。
  down : 上記の IAM 条件付きロールを削除し、公開設定をロールバックする。

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

  # uniform bucket-level access のチェック
  local uba
  uba="$(gcloud storage buckets describe "${BUCKET_URI}" \
    --format="value(uniform_bucket_level_access)" 2>/dev/null || true)"
  
  if [[ "${uba}" == "True" ]]; then
    log "INFO: uniform bucket-level access は有効になっています (${BUCKET_URI})"
  else
    log "ERROR: バケット ${BUCKET_URI} で uniform bucket-level access が有効になっていません。"
    log "       条件付き IAM を使う前に、コンソールまたは CLI から有効化してください。"
    log "       例: gcloud storage buckets update ${BUCKET_URI} --uniform-bucket-level-access"
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
  log " Up: 条件付き IAM で公開前提にする処理を開始します"
  log " バケット : ${BUCKET_URI}"
  log " プレフィックス : ${TARGET_PREFIX}"
  log " 条件タイトル : ${CONDITION_TITLE}"
  log "========================================="

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
  log " Down: 条件付き IAM バインディングをロールバックします"
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

    # 条件がマッチする binding だけを削除対象とする
    if (
        role == role_to_match
        and member_to_remove in members
        and isinstance(cond, dict)
        and cond.get("title") == condition_title
    ):
        # allUsers だけを削除し、他のメンバーは残す
        new_members = [m for m in members if m != member_to_remove]
        if new_members:
            b["members"] = new_members
            new_bindings.append(b)
        # new_members が空なら binding ごと削除
    else:
        new_bindings.append(b)

policy["bindings"] = new_bindings
json.dump(policy, sys.stdout, indent=2, ensure_ascii=False)
PYCODE

  log "更新された IAM ポリシーを適用します..."
  gcloud storage buckets set-iam-policy "${BUCKET_URI}" "${tmp_policy_new}" >/dev/null

  rm -f "${tmp_policy}" "${tmp_policy_new}"

  log "完了: 条件タイトル '${CONDITION_TITLE}' の allUsers バインディングを削除しました。"
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
