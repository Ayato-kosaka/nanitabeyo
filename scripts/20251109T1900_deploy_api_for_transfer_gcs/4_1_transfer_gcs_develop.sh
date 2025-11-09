#!/usr/bin/env bash
# 4_1_transfer_gcs_develop.sh — copy development prefix from OLD private to NEW private
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=develop
load_env
gcloud_check

INFRA="$(infra_path)"

require_env OLD_PRIVATE_BUCKET DEV_PREFIX

log "Transferring prefix ${DEV_PREFIX} from ${OLD_PRIVATE_BUCKET} -> ${PRIVATE_BUCKET}"
run_cmd "\"${INFRA}/transfer_gcs_bucket_prefix.sh\" \"${OLD_PRIVATE_BUCKET}\" \"${DEV_PREFIX}\" \"${PRIVATE_BUCKET}\""

ok "Develop transfer finished: ${OLD_PRIVATE_BUCKET}/${DEV_PREFIX} -> ${PRIVATE_BUCKET}"
