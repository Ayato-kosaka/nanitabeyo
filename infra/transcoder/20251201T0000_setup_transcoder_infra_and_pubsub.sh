#!/usr/bin/env bash

# 変更チケット #503 Transcoder / PubSub / Cloud Run 認証セットアップ (dev / prod)
#
# ## 内容
# - Video Transcoder を利用するための GCP インフラをセットアップする。
# - Transcoder Job 完了通知用 Pub/Sub Topic を dev / prod で分離して作成する。
# - dev / prod それぞれの Cloud Run エンドポイントに対する
#   Pub/Sub Push Subscription (+ OIDC 認証) を構成する。
#
# ## 対象スクリプト
# - infra/transcoder/setup_transcoder_infra.sh
# - infra/transcoder/setup_transcoder_pubsub.sh
#
# ## 背景
# - Transcoder Job 完了通知を Pub/Sub 経由で受け取り、NestJS の /internal/transcoder/webhook で処理する。
# - 1つの Topic に dev / prod 両方の Subscription をぶら下げると、
#   「同じメッセージが dev / prod 両方に配信される」ため、
#   Topic 自体を dev / prod で分離する構成とする。
#
# ## 構成
# - プロジェクト: food-scroll
# - リージョン : asia-northeast1
# - 入出力バケット: nanitabeyo-private
# - 実行 SA (Transcoder ジョブ作成): 386582543095-compute@developer.gserviceaccount.com
# - Pub/Sub Push 用 SA:
#     pubsub-push-transcoder@food-scroll.iam.gserviceaccount.com
# - Topic:
#     dev : projects/food-scroll/topics/transcoder-job-events-dev
#     prod: projects/food-scroll/topics/transcoder-job-events-prod
#
# ## ロールバック
# - IAM / Topic / Subscription を個別に削除する（自動ロールバックは提供しない）。
#
# ## 使い方
#   # dev / prod 両方まとめて実行
#   ./20251201T0000_setup_transcoder_infra_and_pubsub.sh all
#
#   # dev 環境のみ
#   ./20251201T0000_setup_transcoder_infra_and_pubsub.sh dev
#
#   # prod 環境のみ
#   ./20251201T0000_setup_transcoder_infra_and_pubsub.sh prod
#
# ※ 注意:
#   - 実行場所は infra/transcoder ディレクトリを想定
#   - gcloud にログイン済みであること
#   - setup_transcoder_infra.sh / setup_transcoder_pubsub.sh は冪等なコマンドで構成しているため、
#     既に一部適用済みでも再実行して問題ない想定
#

set -euo pipefail

print_usage() {
  sed -n '1,140p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-all}"

case "${MODE}" in
  all|dev|prod)
    ;;
  *)
    echo "MODE が不正です: ${MODE}" >&2
    echo "all / dev / prod のいずれかを指定してください。" >&2
    echo
    print_usage
    exit 1
    ;;
esac

# 共通設定
PROJECT_ID="food-scroll"
REGION="asia-northeast1"

INPUT_BUCKET="nanitabeyo-private"
OUTPUT_BUCKET="nanitabeyo-private"
RUNNER_SA="386582543095-compute@developer.gserviceaccount.com"

# 環境ごとの Topic 名（短い名前）とフルパス
TOPIC_NAME_DEV="transcoder-job-events-dev"
TOPIC_NAME_PROD="transcoder-job-events-prod"

TOPIC_FULL_DEV="projects/${PROJECT_ID}/topics/${TOPIC_NAME_DEV}"
TOPIC_FULL_PROD="projects/${PROJECT_ID}/topics/${TOPIC_NAME_PROD}"

# Pub/Sub Push 用 SA
PUSH_SA_NAME="pubsub-push-transcoder"
PUSH_SA_EMAIL="${PUSH_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Run (dev / prod)
CLOUD_RUN_URL_DEV="https://api-development-386582543095.asia-northeast1.run.app"
RUN_SERVICE_DEV="api-development"

CLOUD_RUN_URL_PROD="https://api-production-386582543095.asia-northeast1.run.app"
RUN_SERVICE_PROD="api-production"

echo "▶️  MODE               : ${MODE}"
echo "▶️  PROJECT_ID         : ${PROJECT_ID}"
echo "▶️  REGION             : ${REGION}"
echo "▶️  INPUT_BUCKET       : ${INPUT_BUCKET}"
echo "▶️  OUTPUT_BUCKET      : ${OUTPUT_BUCKET}"
echo "▶️  RUNNER_SA          : ${RUNNER_SA}"
echo "▶️  TOPIC_FULL_DEV     : ${TOPIC_FULL_DEV}"
echo "▶️  TOPIC_FULL_PROD    : ${TOPIC_FULL_PROD}"
echo "▶️  PUSH_SA_EMAIL      : ${PUSH_SA_EMAIL}"
echo "────────────────────────────────────────────────────────"

# プロジェクト固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# ---------------------------------------------------------------------------
# 1) Transcoder インフラセットアップ（dev / prod それぞれの Topic に対して）
# ---------------------------------------------------------------------------

run_infra_setup() {
  local env_name="$1"
  local topic_full="$2"

  echo "🔧 Step1 (${env_name}): setup_transcoder_infra.sh を実行します…"
  echo "  - TOPIC : ${topic_full}"
  echo

  ./setup_transcoder_infra.sh \
    "${PROJECT_ID}" \
    "${REGION}" \
    "${INPUT_BUCKET}" \
    "${OUTPUT_BUCKET}" \
    "${RUNNER_SA}" \
    "${topic_full}"

  echo "✅ ${env_name}: Transcoder infra setup 完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_infra_setup "dev" "${TOPIC_FULL_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_infra_setup "prod" "${TOPIC_FULL_PROD}"
fi

# ---------------------------------------------------------------------------
# 2) Pub/Sub Push 用サービスアカウントの存在確認 & 作成
# ---------------------------------------------------------------------------
echo "👤 Step2: Pub/Sub Push 用サービスアカウントを確認します…"
if gcloud iam service-accounts describe "${PUSH_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "ℹ️  Service Account 存在済み: ${PUSH_SA_EMAIL}"
else
  echo "📌 Service Account 未作成のため作成します: ${PUSH_SA_EMAIL}"
  gcloud iam service-accounts create "${PUSH_SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="Transcoder Pub/Sub push invoker" \
    --quiet
  echo "✅ Service Account を作成しました: ${PUSH_SA_EMAIL}"
fi
echo

# ---------------------------------------------------------------------------
# 3) dev / prod 向け Pub/Sub Push Subscription の設定
#    ※ setup_transcoder_pubsub.sh は第 6 引数に TOPIC_NAME を取る想定
#       ./setup_transcoder_pubsub.sh PROJECT_ID CLOUD_RUN_URL PUSH_SA_EMAIL RUN_SERVICE_NAME RUN_REGION TOPIC_NAME
# ---------------------------------------------------------------------------

run_pubsub_setup() {
  local env_name="$1"
  local cloud_run_url="$2"
  local run_service_name="$3"
  local topic_name="$4"

  echo "🔔 Step3 (${env_name}): setup_transcoder_pubsub.sh を実行します…"
  echo "  - CLOUD_RUN_URL    : ${cloud_run_url}"
  echo "  - RUN_SERVICE_NAME : ${run_service_name}"
  echo "  - TOPIC_NAME       : ${topic_name}"
  echo

  bash ./setup_transcoder_pubsub.sh \
    "${PROJECT_ID}" \
    "${cloud_run_url}" \
    "${PUSH_SA_EMAIL}" \
    "${run_service_name}" \
    "${REGION}" \
    "${topic_name}"

  echo "✅ ${env_name}: Pub/Sub Push 設定完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_pubsub_setup "dev" "${CLOUD_RUN_URL_DEV}" "${RUN_SERVICE_DEV}" "${TOPIC_NAME_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_pubsub_setup "prod" "${CLOUD_RUN_URL_PROD}" "${RUN_SERVICE_PROD}" "${TOPIC_NAME_PROD}"
fi

echo "🎉 全ての処理が完了しました。"
echo
echo "📌 dev / prod で使用する主な環境変数例:"
cat <<ENV
# dev 環境
GCP_PROJECT=${PROJECT_ID}
TRANSCODER_LOCATION=${REGION}
TRANSCODER_PUBSUB_TOPIC=${TOPIC_FULL_DEV}
PUBSUB_PUSH_SA=${PUSH_SA_EMAIL}

# prod 環境
GCP_PROJECT=${PROJECT_ID}
TRANSCODER_LOCATION=${REGION}
TRANSCODER_PUBSUB_TOPIC=${TOPIC_FULL_PROD}
PUBSUB_PUSH_SA=${PUSH_SA_EMAIL}
ENV
