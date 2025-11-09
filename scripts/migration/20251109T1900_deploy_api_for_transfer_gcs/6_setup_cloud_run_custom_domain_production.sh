#!/usr/bin/env bash
# 6_setup_cloud_run_custom_domain_production.sh — map api.nanitabeyo.net to Cloud Run service
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=production
load_env
gcloud_check

INFRA="$(infra_path)"

require_env PROJECT_ID REGION

# Inputs (fixed by requirements)
SERVICE_NAME="${SERVICE_NAME:-api-production}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-api.nanitabeyo.net}"

log "Setting up Cloud Run custom domain: ${CUSTOM_DOMAIN} -> ${SERVICE_NAME} (${REGION})"
run_cmd "\"${INFRA}/setup_cloud_run_custom_domain.sh\" \"${PROJECT_ID}\" \"${REGION}\" \"${SERVICE_NAME}\" \"${CUSTOM_DOMAIN}\""

ok "Cloud Run custom domain setup requested. Point DNS to the issued endpoints if needed."
