#!/usr/bin/env bash
# #1273 dish_category_recall_probe.ts を回すためのラッパ（解析専用）。
#
# 本番コードを import する都合で api の env バリデータが起動するため、
# **使わない値にダミーを入れて**通す（DB にも外部 API にも接続しない。
# ハーネスが呼ぶのは `matchDishCategories` と辞書合成の純関数だけ）。
#
# 使い方: bash run_probe.sh <out-dir> [probe への追加引数...]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
POC="$REPO/scripts/20260808T0000_restaurant/1273_instagram_seed_poc"
# node_modules は本体チェックアウト側を使う（worktree には入っていないことがある）
MODULES="${PROBE_NODE_MODULES:-$REPO/api/node_modules}"

OUT_DIR="$1"; shift

export API_COMMIT_ID=dummy API_NODE_ENV=development CORS_ORIGIN=http://localhost \
  DATABASE_URL=postgresql://u:p@localhost:5432/db DB_SCHEMA=dev \
  SUPABASE_JWT_SECRET=dummy GOOGLE_PLACE_API_KEY=dummy \
  GCS_BUCKET_NAME=dummy GCS_BUCKET_PUBLIC_NAME=dummy GCS_STATIC_MASTER_DIR_PATH=dummy \
  CLAUDE_API_KEY=dummy GOOGLE_API_KEY=dummy GOOGLE_SEARCH_ENGINE_ID=dummy \
  GCP_PROJECT=dummy TASKS_LOCATION=asia-northeast1 TRANSCODER_LOCATION=asia-northeast1 \
  TRANSCODER_PUBSUB_TOPIC=dummy CLOUD_RUN_URL=http://localhost \
  TASKS_INVOKER_SA=dummy@example.com PUBSUB_PUSH_SA=dummy@example.com \
  CDN_HOST=localhost CDN_KEY_NAME=dummy CDN_KEY_SECRET_B64=ZHVtbXk= CDN_PUBLIC_HOST=localhost

cd "$REPO/api"
NODE_PATH="$MODULES:$REPO/node_modules" TS_NODE_PROJECT="$REPO/api/tsconfig.json" \
  node -r "$MODULES/ts-node/register/transpile-only" -r "$MODULES/tsconfig-paths/register" \
  "$POC/dish_category_recall_probe.ts" "$POC/out/infl_captions.jsonl" "$OUT_DIR" "$@"
