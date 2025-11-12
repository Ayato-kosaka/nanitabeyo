#!/usr/bin/env bash
# 1_1_create_private_bucket.sh — create private bucket + apply CORS
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME="${ENV_NAME:-develop}"  # allow override; not strictly needed here
load_env
gcloud_check

INFRA="$(infra_path)"

log "Creating/ensuring PRIVATE bucket: ${PRIVATE_BUCKET} in ${REGION} (${STORAGE_CLASS}, UBLA=${UBLA})"
run_cmd "${INFRA}/create-gcs-bucket.sh" "${PRIVATE_BUCKET}" "${REGION}" "${STORAGE_CLASS}" "${UBLA}"

log "Applying CORS to PRIVATE bucket (${PRIVATE_BUCKET}) using infra default '*'"
run_cmd "${INFRA}/create-gcs-cors.sh" "${PRIVATE_BUCKET}"

ok "Private bucket ready: ${PRIVATE_BUCKET}"
