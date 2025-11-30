#!/usr/bin/env bash

# 変更チケット #503 Transcoder 周りの Cloud Run / Pub/Sub 認証設定
#
# ## 内容
# - Transcoder API 利用に必要な GCP IAM / API / Pub/Sub Topic をセットアップする。
# - Transcoder Job 完了通知用 Topic を作成し、
#   Cloud Run (NestJS /internal/transcoder/webhook) への Pub/Sub Push + OIDC 認証を構成する。
#
# ## 対象スクリプト
# - infra/transcoder/setup_transcoder_infra.sh
# - infra/transcoder/setup_transcoder_pubsub.sh
#
# ## 背景
# - Video Transcoder の Job 完了を Pub/Sub 経由で Cloud Run に通知し、
#   NestJS 側で OIDCGuard による認証を行う構成にする。
# - Cloud Tasks 用 SA と Pub/Sub Push 用 SA を分離し、権限を最小化する。
#
# ## 対応内容
# 1. Transcoder 用のプロジェクト共通インフラをセットアップ
#    - API 有効化
#    - Transcoder Service Agent / GCS IAM 付与
#    - Transcoder Job 完了通知用 Pub/Sub Topic 作成
# 2. Pub/Sub Push 用サービスアカウントを作成 (存在しない場合)
#    - 名前: pubsub-push-transcoder@food-scroll.iam.gserviceaccount.com
# 3. dev / prod それぞれの Cloud Run エンドポイント向けに Push Subscription を作成
#    - Push endpoint:
#        - dev : https://api-development-386582543095.asia-northeast1.run.app/internal/transcoder/webhook
#        - prod: https://api-production-386582543095.asia-northeast1.run.app/internal/transcoder/webhook
#    - OIDC audience: CLOUD_RUN_URL (ベース URL のみ)
#
# ## ロールバック
# - IAM / Topic / Subscription を個別に削除する (自動ロールバックは提供しない)。
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
#   - 既に setup_transcoder_infra.sh を一部実行済みでも、処理はほぼ冪等なので再実行して問題ない想定
#

set -euo pipefail

print_usage() {
  sed -n '1,120p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-all}"

PROJECT_ID="food-scroll"
REGION="asia-northeast1"

# Transcoder 入出力バケットと、Transcoder ジョブを呼ぶ Cloud Run 実行 SA
INPUT_BUCKET="nanitabeyo-private"
OUTPUT_BUCKET="nanitabeyo-private"
RUNNER_SA="386582543095-compute@developer.gserviceaccount.com"

# Transcoder Job 完了通知用 Pub/Sub Topic（教科書的なフルパス）
TRANSCODER_TOPIC_FULL="projects/${PROJECT_ID}/topics/transcoder-job-events"

# Pub/Sub Push 用サービスアカウント（事前作成 or 自動作成）
PUSH_SA_NAME="pubsub-push-transcoder"
PUSH_SA_EMAIL="${PUSH_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Run URL / サービス名（dev / prod）
CLOUD_RUN_URL_DEV="https://api-development-386582543095.asia-northeast1.run.app"
RUN_SERVICE_DEV="api-development"
CLOUD_RUN_URL_PROD="https://api-production-386582543095.asia-northeast1.run.app"
RUN_SERVICE_PROD="api-production"

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

echo "▶️  MODE              : ${MODE}"
echo "▶️  PROJECT_ID        : ${PROJECT_ID}"
echo "▶️  REGION            : ${REGION}"
echo "▶️  INPUT_BUCKET      : ${INPUT_BUCKET}"
echo "▶️  OUTPUT_BUCKET     : ${OUTPUT_BUCKET}"
echo "▶️  RUNNER_SA         : ${RUNNER_SA}"
echo "▶️  TRANSCODER_TOPIC  : ${TRANSCODER_TOPIC_FULL}"
echo "▶️  PUSH_SA_EMAIL     : ${PUSH_SA_EMAIL}"
echo "────────────────────────────────────────────────────────"

# gcloud プロジェクト固定
gcloud config set project "${PROJECT_ID}" >/dev/null

# ---------------------------------------------------------------------------
# 1) Transcoder インフラ共通セットアップ
#    ※ 既に一度実行済みでも冪等性のあるコマンドのみなので再実行して問題ない想定
# ---------------------------------------------------------------------------
echo "🔧 Step1: Transcoder infra setup (setup_transcoder_infra.sh) を実行します…"

./setup_transcoder_infra.sh \
  "${PROJECT_ID}" \
  "${REGION}" \
  "${INPUT_BUCKET}" \
  "${OUTPUT_BUCKET}" \
  "${RUNNER_SA}" \
  "${TRANSCODER_TOPIC_FULL}"

echo "✅ Transcoder infra setup 完了"
echo

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
# ---------------------------------------------------------------------------

run_pubsub_setup() {
  local env_name="$1"
  local cloud_run_url="$2"
  local run_service_name="$3"

  echo "🔔 Step3 (${env_name}): setup_transcoder_pubsub.sh を実行します…"
  echo "  - CLOUD_RUN_URL   : ${cloud_run_url}"
  echo "  - RUN_SERVICE_NAME: ${run_service_name}"
  echo

  ./setup_transcoder_pubsub.sh \
    "${PROJECT_ID}" \
    "${cloud_run_url}" \
    "${PUSH_SA_EMAIL}" \
    "${run_service_name}" \
    "${REGION}"

  echo "✅ ${env_name} 用 Pub/Sub Push 設定完了"
  echo
}

if [[ "${MODE}" == "all" || "${MODE}" == "dev" ]]; then
  run_pubsub_setup "dev" "${CLOUD_RUN_URL_DEV}" "${RUN_SERVICE_DEV}"
fi

if [[ "${MODE}" == "all" || "${MODE}" == "prod" ]]; then
  run_pubsub_setup "prod" "${CLOUD_RUN_URL_PROD}" "${RUN_SERVICE_PROD}"
fi

echo "🎉 全ての処理が完了しました。"
echo
echo "📌 アプリ側で使用する主な環境変数例:"
cat <<ENV
GCP_PROJECT=${PROJECT_ID}
TRANSCODER_LOCATION=${REGION}
TRANSCODER_PUBSUB_TOPIC=${TRANSCODER_TOPIC_FULL}
PUBSUB_PUSH_SA=${PUSH_SA_EMAIL}
ENV
