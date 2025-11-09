#!/usr/bin/env bash
# 1_2_create_public_bucket.sh — create public bucket + apply CORS
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME="${ENV_NAME:-develop}"
load_env
gcloud_check

INFRA="$(infra_path)"

log "Creating/ensuring PUBLIC bucket: ${PUBLIC_BUCKET} in ${REGION} (${STORAGE_CLASS}, UBLA=${UBLA})"
run_cmd "\"${INFRA}/create-gcs-bucket.sh\" \"${PUBLIC_BUCKET}\" \"${REGION}\" \"${STORAGE_CLASS}\" \"${UBLA}\""

log "Applying CORS to PUBLIC bucket (${PUBLIC_BUCKET}) using infra default '*'"
run_cmd "\"${INFRA}/create-gcs-cors.sh\" \"${PUBLIC_BUCKET}\""

ok "Public bucket ready: ${PUBLIC_BUCKET}"
