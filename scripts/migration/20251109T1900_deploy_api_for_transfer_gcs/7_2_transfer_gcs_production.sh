#!/usr/bin/env bash
# 7_2_transfer_gcs_production.sh — copy production prefix from OLD private to NEW private
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=production
load_env
gcloud_check

INFRA="$(infra_path)"

require_env OLD_PRIVATE_BUCKET PROD_PREFIX

log "Transferring prefix ${PROD_PREFIX} from ${OLD_PRIVATE_BUCKET} -> ${PRIVATE_BUCKET}"
run_cmd "\"${INFRA}/transfer_gcs_bucket_prefix.sh\" \"${OLD_PRIVATE_BUCKET}\" \"${PROD_PREFIX}\" \"${PRIVATE_BUCKET}\""

ok "Production transfer finished: ${OLD_PRIVATE_BUCKET}/${PROD_PREFIX} -> ${PRIVATE_BUCKET}"
