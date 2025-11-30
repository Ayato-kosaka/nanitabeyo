#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_transcoder_infra.sh
# ------------------------------------------------------------------------------
# * 目的:
#   - Transcoder API を呼ぶ Cloud Run の SA に権限付与
#   - Transcoder Service Agent に入出力バケット権限付与
#   - 必要な Google APIs を有効化
#   - （任意）Pub/Sub 通知トピックと権限
#
# 使い方:
#   chmod +x setup_transcoder_infra.sh
#   ./setup_transcoder_infra.sh <PROJECT_ID> <LOCATION> <INPUT_BUCKET> <OUTPUT_BUCKET> <RUNNER_SA_EMAIL> [PUBSUB_TOPIC]
#
# 例:
#   ./setup_transcoder_infra.sh food-scroll us-central1 uploads-food-scroll outputs-food-scroll \
#     cloud-run-sa@food-scroll.iam.gserviceaccount.com projects/food-scroll/topics/transcoder-events
#
# 必要条件:
#   - gcloud CLI がログイン済み (roles/resourcemanager.projectIamAdmin 相当の付与が望ましい)
#   - 実行ユーザにバケット IAM 変更権限
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等 & 判定ガード
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
LOCATION="${2:-us-central1}"
INPUT_BUCKET="${3:-}"
OUTPUT_BUCKET="${4:-}"
RUNNER_SA="${5:-}"             # Cloud Run の実行 SA（Transcoder API を呼ぶ側）
PUBSUB_TOPIC="${6:-}"          # 例: projects/food-scroll/topics/transcoder-events（省略可）

if [[ -z "${PROJECT_ID}" || -z "${INPUT_BUCKET}" || -z "${OUTPUT_BUCKET}" || -z "${RUNNER_SA}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <LOCATION> <INPUT_BUCKET> <OUTPUT_BUCKET> <RUNNER_SA_EMAIL> [PUBSUB_TOPIC]"
  exit 1
fi

echo "▶️  PROJECT_ID     : ${PROJECT_ID}"
echo "▶️  LOCATION       : ${LOCATION}"
echo "▶️  INPUT_BUCKET   : gs://${INPUT_BUCKET}"
echo "▶️  OUTPUT_BUCKET  : gs://${OUTPUT_BUCKET}"
echo "▶️  RUNNER_SA      : ${RUNNER_SA}"
echo "▶️  PUBSUB_TOPIC   : ${PUBSUB_TOPIC:-'(なし)'}"
echo "────────────────────────────────────────────────────────"

# プロジェクトを固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1) 必要な API を有効化（冪等） ------------------------------------------
echo "🔧 Enabling necessary APIs (idempotent)…"
gcloud services enable \
  transcoder.googleapis.com \
  run.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# --- 2) Transcoder のサービスエージェントを明示作成（冪等）--------------------
echo "👤 Ensuring Transcoder service identity…"
gcloud beta services identity create \
  --service=transcoder.googleapis.com \
  --project="${PROJECT_ID}" >/dev/null || true

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
TRANSCODER_SA="service-${PROJECT_NUMBER}@gcp-sa-transcoder.iam.gserviceaccount.com"
echo "ℹ️  Transcoder Service SA : ${TRANSCODER_SA}"

# --- 3) プロジェクト番号 & Transcoder Service Agent -------------------------
echo "ℹ️  Project Number        : ${PROJECT_NUMBER}"
echo "ℹ️  Transcoder Service SA : ${TRANSCODER_SA}"

# --- 4) 呼び出し元（Cloud Run の実行 SA）に Transcoder ジョブ作成権限 --------
# 最速なら admin を付与。後で最小権限に絞る運用でもOK
echo "🔗 Granting Transcoder role to runner SA…"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNNER_SA}" \
  --role="roles/transcoder.admin" \
  --quiet

# --- 5) Transcoder Service Agent に GCS 権限付与 -----------------------------
# 入力: 読み取り / 出力: 書き込み
# gcloud storage の新コマンドを使用（gsutil でも可）
echo "🔗 Granting GCS IAM to Transcoder Service Agent…"
gcloud storage buckets add-iam-policy-binding "gs://${INPUT_BUCKET}" \
  --member="serviceAccount:${TRANSCODER_SA}" \
  --role="roles/storage.objectViewer" \
  --quiet || true

gcloud storage buckets add-iam-policy-binding "gs://${OUTPUT_BUCKET}" \
  --member="serviceAccount:${TRANSCODER_SA}" \
  --role="roles/storage.objectAdmin" \
  --quiet || true

# --- 6) Pub/Sub 通知（任意） -------------------------------------------------
if [[ -n "${PUBSUB_TOPIC}" ]]; then
  echo "🔔 Ensuring Pub/Sub topic & publisher binding…"

  # トピック名を抽出（projects/xxx/topics/yyy → yyy、または単純名をそのまま使用）
  if [[ "${PUBSUB_TOPIC}" == projects/*/topics/* ]]; then
    TOPIC_SHORT_NAME="${PUBSUB_TOPIC##*/}"
  else
    TOPIC_SHORT_NAME="${PUBSUB_TOPIC}"
  fi
  echo "ℹ️  Topic short name: ${TOPIC_SHORT_NAME}"

  # トピック存在チェック（存在しなければ作成）
  if ! gcloud pubsub topics describe "${TOPIC_SHORT_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "📌 Creating topic: ${TOPIC_SHORT_NAME}"
    gcloud pubsub topics create "${TOPIC_SHORT_NAME}" --project="${PROJECT_ID}" --quiet
  else
    echo "ℹ️  Topic exists. Skipping creation."
  fi

  # Transcoder Service Agent に Publisher 付与
  gcloud pubsub topics add-iam-policy-binding "${TOPIC_SHORT_NAME}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${TRANSCODER_SA}" \
    --role="roles/pubsub.publisher" \
    --quiet
  echo "✅ Pub/Sub publisher role granted."
else
  echo "ℹ️  Pub/Sub topic is not specified. Skipping Pub/Sub bindings."
fi

# --- 7) 動作チェックのための軽い出力 -----------------------------------------
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "🔎 Quick verify checklist:"
echo "  - APIs enabled:"
gcloud services list --enabled --format='value(config.name)' | grep -E 'transcoder|run.googleapis|iam.googleapis|storage.googleapis|pubsub.googleapis' || true
echo ""
echo "  - Runner SA has Transcoder role:"
gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --format='table(bindings.role, bindings.members)' \
  --filter="bindings.members:serviceAccount:${RUNNER_SA}" | grep 'roles/transcoder.admin' || true
echo ""
echo "  - Buckets policy (INPUT viewer / OUTPUT admin) assigned to Transcoder SA:"
echo "    INPUT:"
gcloud storage buckets get-iam-policy "gs://${INPUT_BUCKET}" \
  --format='json' | jq -r '.bindings[] | select(.members[]? | contains("'"serviceAccount:${TRANSCODER_SA}"'")) | .role' || true
echo "    OUTPUT:"
gcloud storage buckets get-iam-policy "gs://${OUTPUT_BUCKET}" \
  --format='json' | jq -r '.bindings[] | select(.members[]? | contains("'"serviceAccount:${TRANSCODER_SA}"'")) | .role' || true

echo ""
echo "📌 Use these in your app:"
cat <<ENV
GCP_PROJECT=${PROJECT_ID}
TASKS_LOCATION=${LOCATION}
TRANSCODER_LOCATION=${LOCATION}   # createJob parent: projects/${PROJECT_ID}/locations/${LOCATION}
INPUT_BUCKET=gs://${INPUT_BUCKET}
OUTPUT_BUCKET=gs://${OUTPUT_BUCKET}
TRANSCODER_PUBSUB_TOPIC=${PUBSUB_TOPIC:-'(optional)'}
ENV
