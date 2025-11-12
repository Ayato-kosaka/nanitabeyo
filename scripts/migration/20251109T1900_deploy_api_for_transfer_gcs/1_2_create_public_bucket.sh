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
run_cmd "${INFRA}/create-gcs-bucket.sh" "${PUBLIC_BUCKET}" "${REGION}" "${STORAGE_CLASS}" "${UBLA}"

log "Disabling Public Access Prevention on PUBLIC bucket: ${PUBLIC_BUCKET}"
gcloud storage buckets update gs://${PUBLIC_BUCKET} \
  --public-access-prevention=unspecified

log "Making PUBLIC bucket (${PUBLIC_BUCKET}) objects publicly readable"
gcloud storage buckets add-iam-policy-binding gs://${PUBLIC_BUCKET} \
  --member=allUsers \
  --role=roles/storage.objectViewer

log "Applying CORS to PUBLIC bucket (${PUBLIC_BUCKET}) using infra default '*'"
cat > /tmp/cors.json <<'JSON'
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Cache-Control"],
    "maxAgeSeconds": 3600
  }
]
JSON
gcloud storage buckets update gs://${PUBLIC_BUCKET} --cors-file=/tmp/cors.json

ok "Public bucket ready: ${PUBLIC_BUCKET}"
