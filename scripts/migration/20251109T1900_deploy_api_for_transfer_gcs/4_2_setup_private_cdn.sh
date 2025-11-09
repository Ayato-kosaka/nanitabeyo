#!/usr/bin/env bash
# 4_2_setup_private_cdn.sh — delete old cdn.nanitabeyo.net LB (best-effort) and create new to PRIVATE bucket
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=develop
load_env
gcloud_check

# Best-effort cleanup for old LB pieces (names provided by the user).
# These may or may not exist; ignore errors.
delete_if_exists() {
  local desc="$1"; shift
  local cmd="$*"
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY_RUN] delete_if_exists: ${desc}"
  else
    if "$@" >/dev/null 2>&1; then
      ok "Deleted: ${desc}"
    else
      warn "Skip (not found or already removed): ${desc}"
    fi
  fi
}

log "Best-effort removal of old CDN LB components for host=${CDN_PRIVATE_HOST}"
delete_if_exists "forwarding rule cdn-https-forwarding-rule" "gcloud compute forwarding-rules delete cdn-https-forwarding-rule --global --quiet"
delete_if_exists "url-map cdn-url-map" "gcloud compute url-maps delete cdn-url-map --global --quiet"
delete_if_exists "backend-bucket backend-bucket-cdn" "gcloud compute backend-buckets delete backend-bucket-cdn --quiet"

INFRA="$(infra_path)"

log "Setting up PRIVATE CDN for host=${CDN_PRIVATE_HOST}, bucket=${PRIVATE_BUCKET} (signed cookies)"
run_cmd "\"${INFRA}/setup_cdn_signed_cookies_and_lb.sh\" \"${PROJECT_ID}\" \"${CDN_PRIVATE_HOST}\" \"${PRIVATE_BUCKET}\" \"${CDN_PRIVATE_KEY_NAME}\""

ok "Private CDN setup requested. Remember to update DNS to new LB IP for ${CDN_PRIVATE_HOST}."
