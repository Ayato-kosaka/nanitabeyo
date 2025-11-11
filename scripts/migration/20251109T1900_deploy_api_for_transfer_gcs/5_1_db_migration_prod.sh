#!/usr/bin/env bash
# 5_1_db_migration_prod.sh — run production DB migration at project root
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ENV_NAME=production
load_env

ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATION_FILE="20250924T1200_alter_users_add_fk_and_rls.sql"

log "Applying DB migration on production (schema: ${DB_SCHEMA:-unknown})"
pushd "${ROOT_DIR}" >/dev/null

# Run the migration from project root as requested
run_cmd "pnpm run db:migration ${MIGRATION_FILE}"

popd >/dev/null
ok "DB migration applied: ${MIGRATION_FILE}"
