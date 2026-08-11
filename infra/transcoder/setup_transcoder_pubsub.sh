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
#   ./setup_transcoder_pubsub.sh <PROJECT_ID> <CLOUD_RUN_URL> <PUSH_SA_EMAIL> <RUN_SERVICE_NAME> <RUN_REGION> <TOPIC_NAME>
#
# 例:
#   ./setup_transcoder_pubsub.sh food-scroll https://api-xxx.run.app \
#     cloud-tasks-invoker@food-scroll.iam.gserviceaccount.com api-service asia-northeast1 transcoder-job-events
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
RUN_SERVICE_NAME="${4:-}"  # Cloud Run サービス名
RUN_REGION="${5:-}"        # Cloud Run リージョン
TOPIC_NAME="${6:-}"        # Pub/Sub トピック名（引数で指定）

SUBSCRIPTION_NAME="transcoder-webhook-push-${TOPIC_NAME}"
WEBHOOK_PATH="/internal/transcoder/webhook"

if [[ -z "${PROJECT_ID}" || -z "${CLOUD_RUN_URL}" || -z "${PUSH_SA}" || -z "${RUN_SERVICE_NAME}" || -z "${RUN_REGION}" || -z "${TOPIC_NAME}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <CLOUD_RUN_URL> <PUSH_SA_EMAIL> <RUN_SERVICE_NAME> <RUN_REGION> <TOPIC_NAME>"
  exit 1
fi

echo "▶️  PROJECT_ID     : ${PROJECT_ID}"
echo "▶️  CLOUD_RUN_URL  : ${CLOUD_RUN_URL}"
echo "▶️  PUSH_SA        : ${PUSH_SA}"
echo "▶️  RUN_SERVICE    : ${RUN_SERVICE_NAME}"
echo "▶️  RUN_REGION     : ${RUN_REGION}"
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
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding "${TOPIC_NAME}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${TRANSCODER_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet

echo "✅ Publisher role granted to Transcoder SA."

echo "🔗 Granting Cloud Run invoker role to ${PUSH_SA} on service ${RUN_SERVICE_NAME}…"
gcloud run services add-iam-policy-binding "${RUN_SERVICE_NAME}" \
  --region="${RUN_REGION}" \
  --member="serviceAccount:${PUSH_SA}" \
  --role="roles/run.invoker" \
  --project="${PROJECT_ID}" \
  --quiet
echo "✅ Cloud Run invoker role granted."

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
    --push-auth-token-audience="${CLOUD_RUN_URL}" \
    --ack-deadline=60 \
    --expiration-period=never \
    --quiet
  echo "✅ Subscription created."
else
  echo "ℹ️  Subscription already exists. Updating push config…"
  gcloud pubsub subscriptions update "${SUBSCRIPTION_NAME}" \
    --project="${PROJECT_ID}" \
    --push-endpoint="${PUSH_ENDPOINT}" \
    --push-auth-service-account="${PUSH_SA}" \
    --push-auth-token-audience="${CLOUD_RUN_URL}" \
    --expiration-period=never \
    --quiet
  echo "✅ Subscription updated."
fi

# --- 5) Pub/Sub サービスエージェントに TokenCreator 権限付与 ---------------
echo "🔗 Granting TokenCreator to Pub/Sub service agent on ${PUSH_SA}…"

gcloud iam service-accounts add-iam-policy-binding "${PUSH_SA}" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet || true

echo "✅ TokenCreator role granted to Pub/Sub SA on ${PUSH_SA}."

# --- 6) 動作チェックのための出力 ---------------------------------------------
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
