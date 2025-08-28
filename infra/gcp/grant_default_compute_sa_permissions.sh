#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# grant_default_compute_sa_permissions.sh
# ------------------------------------------------------------------------------
# Default Compute Engine Service Account に以下の権限を付与
#  - 自身へ roles/iam.serviceAccountTokenCreator（signBlob / impersonation 用）
#  - プロジェクトへ roles/storage.objectCreator（GCS アップロード最小権限）
#  - 追加で --extra-gcs-roles=objectViewer,objectAdmin 等を指定可
#
# 特徴 / Best Practices
#  - set -euo pipefail
#  - 冪等（既存権限があっても失敗しない）
#  - dry-run サポート (--dry-run)
#  - PROJECT_ID は引数 / 環境変数 GOOGLE_CLOUD_PROJECT どちらでも可
#
# 使い方:
#  chmod +x infra/gcp/grant_default_compute_sa_permissions.sh
#  ./infra/gcp/grant_default_compute_sa_permissions.sh <PROJECT_ID> [--extra-gcs-roles=objectViewer,objectAdmin] [--sa-email=<OVERRIDE_SA>] [--dry-run]
#
# 例:
#  ./infra/gcp/grant_default_compute_sa_permissions.sh my-project-123 \
#     --extra-gcs-roles=objectViewer \
#     --dry-run
# ------------------------------------------------------------------------------

set -euo pipefail

# ----- Parse Args --------------------------------------------------------------
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
shift || true

EXTRA_GCS_ROLES=""
OVERRIDE_SA_EMAIL=""
DRY_RUN=0

for ARG in "$@"; do
  case "${ARG}" in
    --extra-gcs-roles=*)
      EXTRA_GCS_ROLES="${ARG#*=}"        # comma-separated short names (objectViewer,etc)
      ;;
    --sa-email=*)
      OVERRIDE_SA_EMAIL="${ARG#*=}"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --help|-h)
      echo "Usage: $0 <PROJECT_ID> [--extra-gcs-roles=objectViewer,objectAdmin] [--sa-email=<EMAIL>] [--dry-run]"
      exit 0
      ;;
    *)
      echo "Unknown option: ${ARG}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  exit 1
fi

# ----- Resolve Project Number & SA Email ---------------------------------------
if [[ -n "${OVERRIDE_SA_EMAIL}" ]]; then
  SA_EMAIL="${OVERRIDE_SA_EMAIL}"
else
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
  if [[ -z "${PROJECT_NUMBER}" ]]; then
    echo "❌ プロジェクト番号取得失敗: ${PROJECT_ID}"
    exit 1
  fi
  SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

# ----- Prepare Roles -----------------------------------------------------------
BASE_GCS_ROLE="roles/storage.objectCreator"   # 最小権限
EXTRA_ROLE_LIST=()
if [[ -n "${EXTRA_GCS_ROLES}" ]]; then
  IFS=',' read -r -a EXTRA_ROLE_LIST <<< "${EXTRA_GCS_ROLES}"
fi

# Map short tokens to full roles if user used shorthand like objectViewer
normalize_gcs_role() {
  local token="$1"
  if [[ "${token}" == roles/* ]]; then
    echo "${token}"
  else
    echo "roles/storage.${token}"
  fi
}

# Build final GCS roles array (unique)
declare -A ROLE_SET
ROLE_SET["${BASE_GCS_ROLE}"]=1
for r in "${EXTRA_ROLE_LIST[@]}"; do
  FULL_ROLE="$(normalize_gcs_role "${r}")"
  ROLE_SET["${FULL_ROLE}"]=1
done
GCS_ROLES=("${!ROLE_SET[@]}")

# ----- Display Plan ------------------------------------------------------------
echo "▶️  Project ID:       ${PROJECT_ID}"
echo "▶️  Service Account:  ${SA_EMAIL}"
echo "▶️  GCS Roles:        ${GCS_ROLES[*]}"
echo "▶️  Extra (raw):      ${EXTRA_GCS_ROLES:-'(none)'}"
echo "▶️  Dry Run:          $([[ ${DRY_RUN} -eq 1 ]] && echo yes || echo no)"
echo "───────────────────────────────────────────────"

run() {
  if [[ ${DRY_RUN} -eq 1 ]]; then
    echo "[DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# ----- 1. Enable Required APIs -------------------------------------------------
echo "🔧 Enabling IAM Credentials API (if not enabled)…"
run gcloud services enable iamcredentials.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# (Storage API 通常はデフォルト有効の場合が多いので必須ではないが必要なら以下)
# run gcloud services enable storage.googleapis.com --project="${PROJECT_ID}" --quiet

# ----- 2. Verify Service Account Existence ------------------------------------
if ! gcloud iam service-accounts list \
  --project "${PROJECT_ID}" \
  --filter="email=${SA_EMAIL}" \
  --format="value(email)" | grep -q "${SA_EMAIL}"; then
  echo "⚠️  指定 Service Account が存在しません: ${SA_EMAIL}"
  echo "    (Compute Engine を一度有効化してインスタンス作成すると生成されます)"
  if [[ ${DRY_RUN} -eq 0 ]]; then
    exit 1
  fi
fi

# ----- 3. Grant Self Token Creator --------------------------------------------
echo "🔗 Granting roles/iam.serviceAccountTokenCreator (self-binding)…"
run gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="${PROJECT_ID}" \
  --quiet

# ----- 4. Grant GCS Roles ------------------------------------------------------
for ROLE in "${GCS_ROLES[@]}"; do
  echo "🔗 Granting ${ROLE} on project to ${SA_EMAIL}"
  run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --quiet
done

# ----- 5. Summary --------------------------------------------------------------
echo "🎉 完了 (${DRY_RUN:-0} == 1 なら未適用)!"
echo ""
echo "環境変数例:"
echo "GCP_PROJECT=${PROJECT_ID}"
echo "COMPUTE_DEFAULT_SA=${SA_EMAIL}"
echo ""
echo "付与済 (予定) 役割:"
echo " - roles/iam.serviceAccountTokenCreator (self)"
for ROLE in "${GCS_ROLES[@]}"; do
  echo " - ${ROLE}"
done
echo ""
echo "最小権限ポリシー: objectCreator のみが推奨。追加ロールは用途に応じて最小化してください。"
