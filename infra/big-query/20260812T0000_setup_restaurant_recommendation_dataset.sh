#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# 店提案用の事前データを保持する BigQuery Dataset を作成する。
#
# 【設計方針】
# - 料理カテゴリ用の `wikidata_food_graph` とは分離する。
# - dev / prod や raw / catalog では Dataset を分けない。
# - PostgreSQL の dev / public の切り替えは、既存の料理同期と同様に 9_* 側で行う。
# - Dataset の作成だけを責務とし、テーブル作成は
#   scripts/20260808T0000_restaurant/1_1_create_tables.py が担当する。
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-food-scroll}"
DATASET_ID="${BQ_DATASET:-restaurant_recommendation}"
REGION="${BQ_REGION:-asia-northeast1}"

gcloud services enable bigquery.googleapis.com \
  --project="${PROJECT_ID}" \
  --quiet

if bq show --project_id="${PROJECT_ID}" "${DATASET_ID}" >/dev/null 2>&1; then
  echo "Dataset already exists: ${PROJECT_ID}.${DATASET_ID}"
  exit 0
fi

bq --location="${REGION}" mk \
  --project_id="${PROJECT_ID}" \
  --dataset \
  --description="Restaurant recommendation source, matching, media, coverage and PostgreSQL publish data" \
  "${DATASET_ID}"

echo "Created Dataset: ${PROJECT_ID}.${DATASET_ID} (${REGION})"
