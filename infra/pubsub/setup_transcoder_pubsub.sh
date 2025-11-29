#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_transcoder_pubsub.sh
# ------------------------------------------------------------------------------
# * 目的:
#   - Transcoder Job 完了通知用の Pub/Sub Topic 作成
#   - Push Subscription の作成（NestJS /internal/transcoder/webhook へ）
#   - Transcoder Service Agent に Publisher 権限付与
#
# 使い方:
#   chmod +x setup_transcoder_pubsub.sh
#   ./setup_transcoder_pubsub.sh <PROJECT_ID> <CLOUD_RUN_URL> <PUSH_SA_EMAIL>
#
# 例:
#   ./setup_transcoder_pubsub.sh food-scroll https://api-xxx.run.app \
#     cloud-tasks-invoker@food-scroll.iam.gserviceaccount.com
#
# 必要条件:
#   - gcloud CLI がログイン済み
#   - 実行ユーザに Pub/Sub 管理権限
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等 & 判定ガード
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
CLOUD_RUN_URL="${2:-}"
PUSH_SA="${3:-}"  # Push 認証用 SA（OIDC トークン発行）

TOPIC_NAME="transcoder-job-events"
SUBSCRIPTION_NAME="transcoder-webhook-push"
WEBHOOK_PATH="/internal/transcoder/webhook"

if [[ -z "${PROJECT_ID}" || -z "${CLOUD_RUN_URL}" || -z "${PUSH_SA}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <CLOUD_RUN_URL> <PUSH_SA_EMAIL>"
  exit 1
fi

echo "▶️  PROJECT_ID     : ${PROJECT_ID}"
echo "▶️  CLOUD_RUN_URL  : ${CLOUD_RUN_URL}"
echo "▶️  PUSH_SA        : ${PUSH_SA}"
echo "▶️  TOPIC_NAME     : ${TOPIC_NAME}"
echo "▶️  SUBSCRIPTION   : ${SUBSCRIPTION_NAME}"
echo "────────────────────────────────────────────────────────"

# プロジェクトを固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1) Pub/Sub API 有効化（冪等） ------------------------------------------
echo "🔧 Enabling Pub/Sub API (idempotent)…"
gcloud services enable pubsub.googleapis.com --project="${PROJECT_ID}" --quiet

# --- 2) Topic 作成（冪等） ---------------------------------------------------
echo "📌 Creating Pub/Sub topic: ${TOPIC_NAME}…"
if ! gcloud pubsub topics describe "${TOPIC_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub topics create "${TOPIC_NAME}" --project="${PROJECT_ID}" --quiet
  echo "✅ Topic created."
else
  echo "ℹ️  Topic already exists. Skipping."
fi

TOPIC_FULL_NAME="projects/${PROJECT_ID}/topics/${TOPIC_NAME}"

# --- 3) Transcoder Service Agent に Publisher 権限付与 ----------------------
echo "🔗 Granting Pub/Sub Publisher to Transcoder Service Agent…"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
TRANSCODER_SA="service-${PROJECT_NUMBER}@gcp-sa-transcoder.iam.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding "${TOPIC_NAME}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${TRANSCODER_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet

echo "✅ Publisher role granted to Transcoder SA."

# --- 4) Push Subscription 作成（冪等） ---------------------------------------
PUSH_ENDPOINT="${CLOUD_RUN_URL}${WEBHOOK_PATH}"
echo "📌 Creating Push Subscription: ${SUBSCRIPTION_NAME}…"
echo "   Push endpoint: ${PUSH_ENDPOINT}"

if ! gcloud pubsub subscriptions describe "${SUBSCRIPTION_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "${SUBSCRIPTION_NAME}" \
    --project="${PROJECT_ID}" \
    --topic="${TOPIC_NAME}" \
    --push-endpoint="${PUSH_ENDPOINT}" \
    --push-auth-service-account="${PUSH_SA}" \
    --ack-deadline=60 \
    --quiet
  echo "✅ Subscription created."
else
  echo "ℹ️  Subscription already exists. Updating push config…"
  gcloud pubsub subscriptions update "${SUBSCRIPTION_NAME}" \
    --project="${PROJECT_ID}" \
    --push-endpoint="${PUSH_ENDPOINT}" \
    --push-auth-service-account="${PUSH_SA}" \
    --quiet
  echo "✅ Subscription updated."
fi

# --- 5) 動作チェックのための出力 ---------------------------------------------
echo ""
echo "✅ Setup completed."
echo "────────────────────────────────────────────────────────"
echo "📌 Transcoder Job に設定する通知トピック:"
echo "   PUBSUB_TOPIC=${TOPIC_FULL_NAME}"
echo ""
echo "📌 Webhook エンドポイント:"
echo "   ${PUSH_ENDPOINT}"
echo ""
echo "🔎 Quick verify:"
echo "   gcloud pubsub topics list --project=${PROJECT_ID}"
echo "   gcloud pubsub subscriptions list --project=${PROJECT_ID}"
