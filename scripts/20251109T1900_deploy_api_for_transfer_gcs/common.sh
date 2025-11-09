#!/usr/bin/env bash
# common.sh — shared helpers for migration scripts
# Safety: strict mode + traps, safe logging, DRY_RUN support, env loader/validator.

set -Eeuo pipefail

# ----- Pretty logging -----
COLOR_RESET='\033[0m'
COLOR_INFO='\033[1;34m'
COLOR_WARN='\033[1;33m'
COLOR_ERR='\033[1;31m'
COLOR_OK='\033[1;32m'

_ts() { date +"%Y-%m-%dT%H:%M:%S%z"; }
log()   { printf "${COLOR_INFO}[%s] [INFO] %s${COLOR_RESET}\n" "$(_ts)" "$*"; }
warn()  { printf "${COLOR_WARN}[%s] [WARN] %s${COLOR_RESET}\n" "$(_ts)" "$*"; }
err()   { printf "${COLOR_ERR}[%s] [ERR ] %s${COLOR_RESET}\n" "$(_ts)" "$*"; }
ok()    { printf "${COLOR_OK}[%s] [ OK ] %s${COLOR_RESET}\n" "$(_ts)" "$*"; }

# ----- Trap -----
cleanup() {
  code=$?
  if [[ $code -ne 0 ]]; then
    err "Exited with code $code"
  fi
}
trap cleanup EXIT

# ----- DRY_RUN -----
: "${DRY_RUN:=false}"
run_cmd() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY_RUN] $*"
  else
    log "exec: $*"
    "$@"
  fi
}

# ----- Env loader -----
# Usage: require_env VAR_NAME [...]
require_env() {
  local missing=0
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      err "Missing required env: ${var}"
      missing=1
    fi
  done
  if [[ $missing -eq 1 ]]; then
    exit 1
  fi
}

# Load .env chain: .env.common then script-specific (.env.develop / .env.production)
# The caller script should set ENV_FILE (relative path) or ENV_NAME=develop|production to auto-pick.
load_env() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local root_dir="$(cd "${script_dir}/../../.." && pwd)"

  # Always load .env.common first
  if [[ -f "${script_dir}/.env.common" ]]; then
    set -a; source "${script_dir}/.env.common"; set +a
    log "Loaded ${script_dir}/.env.common"
  elif [[ -f "${root_dir}/.env.common" ]]; then
    set -a; source "${root_dir}/.env.common"; set +a
    log "Loaded ${root_dir}/.env.common"
  fi

  # ENV_FILE has priority; otherwise ENV_NAME -> .env.<name>
  if [[ -n "${ENV_FILE:-}" ]]; then
    if [[ -f "${ENV_FILE}" ]]; then
      set -a; source "${ENV_FILE}"; set +a
      log "Loaded ${ENV_FILE}"
    else
      err "ENV_FILE specified but not found: ${ENV_FILE}"
      exit 1
    fi
  elif [[ -n "${ENV_NAME:-}" ]]; then
    local env_path="${script_dir}/.env.${ENV_NAME}"
    if [[ -f "${env_path}" ]]; then
      set -a; source "${env_path}"; set +a
      log "Loaded ${env_path}"
    else
      err "ENV_NAME=${ENV_NAME} but file not found: ${env_path}"
      exit 1
    fi
  else
    warn "No ENV_FILE / ENV_NAME provided; using .env.common only"
  fi

  # Basic validations
  require_env PROJECT_ID REGION PUBLIC_BUCKET PRIVATE_BUCKET STORAGE_CLASS UBLA
  require_env CDN_PUBLIC_HOST CDN_PRIVATE_HOST
  require_env CDN_PUBLIC_KEY_NAME CDN_PRIVATE_KEY_NAME
  require_env DEV_PREFIX PROD_PREFIX
  # Optional: OLD_PRIVATE_BUCKET (required by transfer scripts)
}

# gcloud sanity
gcloud_check() {
  if ! command -v gcloud >/dev/null 2>&1; then
    err "gcloud not found. Install Google Cloud CLI."
    exit 1
  fi
  local active_proj
  active_proj="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -z "${active_proj}" ]]; then
    warn "gcloud active project is empty; setting to PROJECT_ID=${PROJECT_ID}"
    run_cmd "gcloud config set project ${PROJECT_ID}"
  elif [[ "${active_proj}" != "${PROJECT_ID}" ]]; then
    warn "gcloud active project (${active_proj}) != PROJECT_ID (${PROJECT_ID}); switching"
    run_cmd "gcloud config set project ${PROJECT_ID}"
  fi
}

# Path to infra scripts (relative to repo root)
infra_path() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local root_dir="$(cd "${script_dir}/../../.." && pwd)"
  echo "${root_dir}/infra/gcp"
}
