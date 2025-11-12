#!/usr/bin/env bash
# 3_1_setup_public_cdn.sh — create Cloud CDN (signed cookies) to PUBLIC bucket
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME="${ENV_NAME:-develop}"
load_env
gcloud_check

INFRA="$(infra_path)"

log "Setting up PUBLIC CDN for host=${CDN_PUBLIC_HOST}, bucket=${PUBLIC_BUCKET} (signed cookies)"
# TTL omitted to use infra default. Key name provided.
run_cmd "${INFRA}/setup_cdn_signed_cookies_and_lb.sh" "${PROJECT_ID}" "${CDN_PUBLIC_HOST}" "${PUBLIC_BUCKET}" "${CDN_PUBLIC_KEY_NAME}"

ok "Public CDN setup requested. Remember to point DNS to new LB IP for ${CDN_PUBLIC_HOST}."
