#!/usr/bin/env bash
#
# Issue #1595: 同期前 backup を db-script-run.yml の実行 SA から読み戻せるようにする。
#
# storage.objects.list はバケット単位の権限なので、バケット IAM の
# resource.name.startsWith 条件では一覧範囲を object prefix に限定できない。
# そのため backup prefix を managed folder にし、その folder にだけ
# roles/storage.objectViewer を付与する。
# prefix 限定の list request では prefix に加え、delimiter=/ と
# includeFoldersAsPrefixes=true を指定する必要がある。
#
# 既定は dry-run。実際に変更するときだけ --apply を指定する。
#
#   ./infra/gcp/20260826T0000_grant_feature_correction_backup_reader.sh
#   ./infra/gcp/20260826T0000_grant_feature_correction_backup_reader.sh --apply

set -euo pipefail

readonly BUCKET_NAME="nanitabeyo-private"
readonly BACKUP_PREFIX="system/PostgreSQL/csv_export/"
readonly SERVICE_ACCOUNT="feature-correction-writer@food-scroll.iam.gserviceaccount.com"
readonly ROLE="roles/storage.objectViewer"
readonly BUCKET_URI="gs://${BUCKET_NAME}"
readonly MANAGED_FOLDER_URI="${BUCKET_URI}/${BACKUP_PREFIX}"
readonly MEMBER="serviceAccount:${SERVICE_ACCOUNT}"

APPLY=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply]

${MEMBER} に ${MANAGED_FOLDER_URI} 配下だけの読み取り権限を設定します。

  引数なし  現状と変更予定を表示する（既定、変更しない）
  --apply    managed folder の作成と IAM binding の付与を実行する
  -h, --help この help を表示する

実行者には対象 bucket に対する managed folder の作成・IAM policy 更新権限が
必要です。db-script-run.yml が借用する対象 SA 自身ではなく、管理権限を持つ
principal で実行してください。
EOF
}

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

parse_args() {
  while (($#)); do
    case "$1" in
      --apply)
        APPLY=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "不明な引数です: $1"
        ;;
    esac
    shift
  done
}

check_prerequisites() {
  command -v gcloud >/dev/null 2>&1 || die "gcloud が見つかりません。"
  command -v python3 >/dev/null 2>&1 || die "python3 が見つかりません。"

  local ubla
  ubla="$(gcloud storage buckets describe "${BUCKET_URI}" \
    --format='value(uniform_bucket_level_access)')"
  [[ "${ubla,,}" == "true" ]] || die \
    "managed folder には uniform bucket-level access が必要です（現在値: ${ubla:-<empty>}）。"
}

managed_folder_exists() {
  local error_file
  error_file="$(mktemp)"
  if gcloud storage managed-folders describe "${MANAGED_FOLDER_URI}" \
    --format=json >/dev/null 2>"${error_file}"; then
    rm -f "${error_file}"
    return 0
  fi

  if grep -Eqi 'not[ _-]?found|does not exist|status[^0-9]*404|[^0-9]404[^0-9]' \
    "${error_file}"; then
    rm -f "${error_file}"
    return 1
  fi

  log "ERROR: managed folder の状態を取得できませんでした。" >&2
  sed 's/^/  /' "${error_file}" >&2
  rm -f "${error_file}"
  exit 1
}

get_managed_folder_policy() {
  gcloud storage managed-folders get-iam-policy "${MANAGED_FOLDER_URI}" \
    --format=json
}

policy_has_binding() {
  local policy_json="$1"
  POLICY_JSON="${policy_json}" python3 - "${ROLE}" "${MEMBER}" <<'PY'
import json
import os
import sys

policy = json.loads(os.environ["POLICY_JSON"])
role, member = sys.argv[1:]
found = any(
    binding.get("role") == role
    and member in binding.get("members", [])
    and not binding.get("condition")
    for binding in policy.get("bindings", [])
)
raise SystemExit(0 if found else 1)
PY
}

print_relevant_bindings() {
  local heading="$1"
  local policy_json="$2"
  log "${heading}"
  POLICY_JSON="${policy_json}" python3 - "${ROLE}" "${MEMBER}" <<'PY'
import json
import os
import sys

policy = json.loads(os.environ["POLICY_JSON"])
role, member = sys.argv[1:]
bindings = [
    binding
    for binding in policy.get("bindings", [])
    if binding.get("role") == role or member in binding.get("members", [])
]
print(json.dumps({"bindings": bindings}, ensure_ascii=False, indent=2))
PY
}

print_plan() {
  log "変更予定（まだ適用していません）:"
  log "  1. managed folder がなければ作成: ${MANAGED_FOLDER_URI}"
  log "  2. 次の binding がなければ付与:"
  log "     member: ${MEMBER}"
  log "     role:   ${ROLE}"
  log "     scope:  ${MANAGED_FOLDER_URI}"
  log "適用する場合: $(basename "$0") --apply"
}

main() {
  parse_args "$@"
  check_prerequisites

  log "対象 bucket:         ${BUCKET_URI}"
  log "対象 managed folder: ${MANAGED_FOLDER_URI}"
  log "対象 member:         ${MEMBER}"
  log "付与 role:           ${ROLE}"
  if ((APPLY)); then
    log "mode: apply"
  else
    log "mode: dry-run（変更しません）"
  fi

  local folder_exists=0
  local before_policy='{"bindings": []}'
  if managed_folder_exists; then
    folder_exists=1
    before_policy="$(get_managed_folder_policy)"
  fi

  log "managed folder（変更前）: $([[ ${folder_exists} -eq 1 ]] && echo exists || echo absent)"
  print_relevant_bindings "関連 binding（変更前）:" "${before_policy}"

  if ((APPLY == 0)); then
    if ((folder_exists)) && policy_has_binding "${before_policy}"; then
      log "変更予定: なし（managed folder と IAM binding は設定済みです）。"
    else
      print_plan
    fi
    exit 0
  fi

  if ((folder_exists == 0)); then
    log "managed folder を作成します: ${MANAGED_FOLDER_URI}"
    gcloud storage managed-folders create "${MANAGED_FOLDER_URI}" --quiet
  else
    log "managed folder は作成済みです。"
  fi

  local current_policy
  current_policy="$(get_managed_folder_policy)"
  if policy_has_binding "${current_policy}"; then
    log "IAM binding は付与済みです。変更をスキップします。"
  else
    log "IAM binding を付与します。"
    gcloud storage managed-folders add-iam-policy-binding \
      "${MANAGED_FOLDER_URI}" \
      --member="${MEMBER}" \
      --role="${ROLE}" \
      --quiet >/dev/null
  fi

  local after_policy
  after_policy="$(get_managed_folder_policy)"
  print_relevant_bindings "関連 binding（変更後）:" "${after_policy}"
  policy_has_binding "${after_policy}" || die "適用後の IAM binding を確認できませんでした。"
  log "完了: backup prefix 配下の object get/list 権限を付与しました。"
  log "NOTE: prefix の list では delimiter=/ と includeFoldersAsPrefixes=true も指定してください。"
  log "      通常の 'gcloud storage ls' はこの指定に対応せず 403 になります。"
}

main "$@"
