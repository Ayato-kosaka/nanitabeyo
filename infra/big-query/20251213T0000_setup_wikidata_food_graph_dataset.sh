#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# 20251213T0000_setup_wikidata_food_graph_dataset.sh
# ------------------------------------------------------------------------------
# チケット #533 Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
#
# * 目的:
#   - BigQuery API を有効化
#   - Wikidata 食品グラフ用の BigQuery Dataset を作成（冪等）
#   - ロケーション設定
#
# 使い方:
#   chmod +x 20251213T0000_setup_wikidata_food_graph_dataset.sh
#   ./20251213T0000_setup_wikidata_food_graph_dataset.sh
#
# 必要条件:
#   - gcloud CLI がログイン済み
#   - 実行ユーザに BigQuery 管理権限
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等 & 判定ガード
# ------------------------------------------------------------------------------

set -euo pipefail

# 固定値
PROJECT_ID="food-scroll"
DATASET_ID="wikidata_food_graph"
REGION="asia-northeast1"

echo "▶️  PROJECT_ID   : ${PROJECT_ID}"
echo "▶️  DATASET_ID   : ${DATASET_ID}"
echo "▶️  REGION       : ${REGION}"
echo "────────────────────────────────────────────────────────"

# プロジェクトを固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1) BigQuery API 有効化（冪等） ------------------------------------------
echo "🔧 Enabling BigQuery API (idempotent)…"
gcloud services enable bigquery.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# --- 2) Dataset 存在チェック & 作成（冪等） -----------------------------------
echo "📌 Creating BigQuery Dataset: ${DATASET_ID}…"

if bq show --project_id="${PROJECT_ID}" "${DATASET_ID}" >/dev/null 2>&1; then
  echo "ℹ️  Dataset already exists. Skipping creation."
else
  bq --location="${REGION}" mk \
    --project_id="${PROJECT_ID}" \
    --dataset \
    --description="Wikidata food graph dataset for dish/beverage analysis" \
    "${DATASET_ID}"
  echo "✅ Dataset created."
fi

# --- 3) 動作チェックのための出力 ---------------------------------------------
echo ""
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "🔎 Quick verify:"
echo "   bq show --project_id=${PROJECT_ID} ${DATASET_ID}"
echo ""
echo "📌 Dataset details:"
bq show --project_id="${PROJECT_ID}" "${DATASET_ID}"
