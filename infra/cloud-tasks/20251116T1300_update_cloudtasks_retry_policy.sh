#!/usr/bin/env bash

# 変更チケット #439 Cloud Tasks のリトライポリシー見直し用スクリプト追加（maxAttempts=5 / 期限付きリトライ）
#
# ## 背景
# 現在 Cloud Tasks のリトライ回数が多く、何度リトライしても通らないリクエストに対しても
# 延々リトライしてしまい、その結果サーバー（Cloud Run / GCE 等）が無駄に起動し課金インパクトが出ている。
#
# ## 対応内容
# Cloud Tasks のリトライポリシーを「少数回＋期限つき」に変更し、無駄なリトライとサーバー起動を減らす。
#
# ## リトライポリシー設定値
# - maxAttempts:       5          # ユーザー体感的にも妥当な値として合意
# - maxRetryDuration:  600s (10m) # タスク作成から10分以内に成功しなければ諦める
# - minBackoff:        10s        # 1回目以降の再試行まで最低10秒あける
# - maxBackoff:        300s (5m)  # リトライ間隔の上限は5分
# - maxDoublings:      3          # 指数バックオフさせる回数
#
# ## 対象キュー
# - dish-queue          (料理メディア作成ジョブ)
# - image-resize-queue  (画像リサイズジョブ)
# - notification-queue  (通知ジョブ)
#
# ## 注意事項
# - 4xx エラーで速やかに諦める実装や Cloud Logging + Cloud Monitoring によるアラート設定は別途対応予定
#
# ## 使い方
#   # リトライポリシーを適用 (UP)
#   ./20251116T1300_update_cloudtasks_retry_policy.sh up <LOCATION> [PROJECT_ID]
#
#   # ロールバック (DOWN) - デフォルトのリトライ設定に戻す
#   ./20251116T1300_update_cloudtasks_retry_policy.sh down <LOCATION> [PROJECT_ID]
#
#   例:
#     # 本番 ・ 開発
#     ./20251116T1300_update_cloudtasks_retry_policy.sh up uasia-northeast1 food-scroll
#     ./20251116T1300_update_cloudtasks_retry_policy.sh down uasia-northeast1 food-scroll
#
# ※ 注意:
#   - gcloud にログイン済みであること
#   - PROJECT_ID を省略した場合、gcloud のデフォルトプロジェクトが使われます
#   - LOCATION は Cloud Tasks のロケーション（例: us-central1, asia-northeast1）
#

set -euo pipefail

# 対象キュー一覧
QUEUES=(
  "dish-queue"
  "image-resize-queue"
  "notification-queue"
)

# リトライポリシー設定値
MAX_ATTEMPTS=5
MAX_RETRY_DURATION="600s"
MIN_BACKOFF="10s"
MAX_BACKOFF="300s"
MAX_DOUBLINGS=3

# デフォルト値（ロールバック用）
# Cloud Tasks のデフォルトは unlimited attempts, unlimited duration
DEFAULT_MAX_ATTEMPTS=100
DEFAULT_MAX_RETRY_DURATION="0s"  # 0s = unlimited
DEFAULT_MIN_BACKOFF="0.100s"     # 100ms
DEFAULT_MAX_BACKOFF="3600s"      # 1h
DEFAULT_MAX_DOUBLINGS=16

print_usage() {
  sed -n '1,120p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >&2
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-}"
LOCATION="${2:-}"
PROJECT_ID="${3:-:-}"

if [[ -z "$MODE" || -z "$LOCATION" ]]; then
  echo "引数が不足しています。" >&2
  echo >&2
  print_usage
  exit 1
fi

# gcloud コマンドの存在確認
if ! command -v gcloud >/dev/null 2>&1; then
  log "ERROR: gcloud が見つかりません。Cloud SDK をインストールしてください。"
  exit 1
fi

# プロジェクト設定
if [[ "${PROJECT_ID}" != ":-" && -n "${PROJECT_ID}" ]]; then
  PROJECT_DISPLAY="${PROJECT_ID}"
else
  PROJECT_DISPLAY="(gcloud デフォルトを使用)"
fi

build_gcloud_cmd() {
  local cmd_array=("$@")
  
  if [[ "${PROJECT_ID}" != ":-" && -n "${PROJECT_ID}" ]]; then
    cmd_array+=("--project=${PROJECT_ID}")
  fi
  
  printf '%s\n' "${cmd_array[@]}"
}

update_queue_retry_policy() {
  local queue_name="$1"
  local max_attempts="$2"
  local max_retry_duration="$3"
  local min_backoff="$4"
  local max_backoff="$5"
  local max_doublings="$6"

  log "キュー '${queue_name}' のリトライポリシーを更新中..."

  # gcloud tasks queues update コマンドを実行
  local gcloud_cmd
  readarray -t gcloud_cmd < <(build_gcloud_cmd \
    gcloud tasks queues update "${queue_name}" \
    --location="${LOCATION}")
  
  "${gcloud_cmd[@]}" \
    --max-attempts="${max_attempts}" \
    --max-retry-duration="${max_retry_duration}" \
    --min-backoff="${min_backoff}" \
    --max-backoff="${max_backoff}" \
    --max-doublings="${max_doublings}"

  log "✅ キュー '${queue_name}' の更新完了"
}

show_current_settings() {
  local queue_name="$1"

  log "キュー '${queue_name}' の現在の設定を確認中..."
  
  local gcloud_cmd
  readarray -t gcloud_cmd < <(build_gcloud_cmd \
    gcloud tasks queues describe "${queue_name}" \
    --location="${LOCATION}")
  
  "${gcloud_cmd[@]}" --format="yaml(retryConfig)" || true
  echo
}

case "$MODE" in
  up)
    log "========================================="
    log "🟦 Cloud Tasks Retry Policy Update (UP) 開始"
    log "  - location     : ${LOCATION}"
    log "  - project      : ${PROJECT_DISPLAY}"
    log "  - 対象キュー   : ${QUEUES[*]}"
    log "========================================="
    log "  リトライポリシー設定値:"
    log "    maxAttempts      : ${MAX_ATTEMPTS}"
    log "    maxRetryDuration : ${MAX_RETRY_DURATION}"
    log "    minBackoff       : ${MIN_BACKOFF}"
    log "    maxBackoff       : ${MAX_BACKOFF}"
    log "    maxDoublings     : ${MAX_DOUBLINGS}"
    log "========================================="
    echo

    for queue in "${QUEUES[@]}"; do
      log "--- キュー: ${queue} ---"
      show_current_settings "${queue}"
      update_queue_retry_policy \
        "${queue}" \
        "${MAX_ATTEMPTS}" \
        "${MAX_RETRY_DURATION}" \
        "${MIN_BACKOFF}" \
        "${MAX_BACKOFF}" \
        "${MAX_DOUBLINGS}"
      echo
      log "更新後の設定:"
      show_current_settings "${queue}"
      echo
    done

    log "========================================="
    log "✅ UP 完了: すべてのキューのリトライポリシーを更新しました"
    log "========================================="
    ;;

  down)
    log "========================================="
    log "🟥 Cloud Tasks Retry Policy Rollback (DOWN) 開始"
    log "  - location     : ${LOCATION}"
    log "  - project      : ${PROJECT_DISPLAY}"
    log "  - 対象キュー   : ${QUEUES[*]}"
    log "========================================="
    log "  デフォルト設定値（ロールバック）:"
    log "    maxAttempts      : ${DEFAULT_MAX_ATTEMPTS}"
    log "    maxRetryDuration : ${DEFAULT_MAX_RETRY_DURATION} (unlimited)"
    log "    minBackoff       : ${DEFAULT_MIN_BACKOFF}"
    log "    maxBackoff       : ${DEFAULT_MAX_BACKOFF}"
    log "    maxDoublings     : ${DEFAULT_MAX_DOUBLINGS}"
    log "========================================="
    echo

    for queue in "${QUEUES[@]}"; do
      log "--- キュー: ${queue} ---"
      show_current_settings "${queue}"
      update_queue_retry_policy \
        "${queue}" \
        "${DEFAULT_MAX_ATTEMPTS}" \
        "${DEFAULT_MAX_RETRY_DURATION}" \
        "${DEFAULT_MIN_BACKOFF}" \
        "${DEFAULT_MAX_BACKOFF}" \
        "${DEFAULT_MAX_DOUBLINGS}"
      echo
      log "ロールバック後の設定:"
      show_current_settings "${queue}"
      echo
    done

    log "========================================="
    log "⏪ DOWN 完了: すべてのキューをデフォルト設定に戻しました"
    log "========================================="
    ;;

  *)
    log "ERROR: MODE が不正です: ${MODE}"
    log "up または down を指定してください。"
    echo >&2
    print_usage
    exit 1
    ;;
esac
