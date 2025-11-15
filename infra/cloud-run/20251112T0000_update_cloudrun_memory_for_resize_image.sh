#!/usr/bin/env bash

# 変更チケット #426 Cloud Tasks 経由の画像リサイズ処理で Cloud Run が OOM し 503（UNAVAILABLE）が発生する問題の対応
#
# ## 内容
# - Cloud Run サービスのメモリ上限を 512MiB → 1Gi に引き上げ、
#   Cloud Tasks 経由の画像リサイズ処理で発生している OOM / 503 を暫定的に解消する。
#
# ## 背景
# - Cloud Tasks から Cloud Run サービス `api-development` の
#   `POST /internal/resize-image` を呼び出して画像リサイズ＆保存を行っている。
# - 2025-11-13 の実行で、Cloud Tasks 側で `UNAVAILABLE(14)` / HTTP 503 が発生。
# - Cloud Run ログ上では `Memory limit of 512 MiB exceeded with 538 MiB used.` と出ており、
#   画像処理中にメモリ上限 512MiB を超過してコンテナが OOM Kill されている。
#
# ## 対応
# - 対象 Cloud Run サービスのメモリ上限を 1Gi に増加させる。
#   - 例:
#     - api-development: 512MiB → 1Gi
#     - api-production : 512MiB → 1Gi
#
# ## ロールバック
# - メモリ上限を元の 512MiB に戻す。
#
# ## 使い方
#   # メモリ上限を 1Gi に変更 (UP)
#   ./20251115T0001_update_cloudrun_memory_for_resize_image.sh up   <SERVICE_NAME> <REGION> [PROJECT_ID]
#
#   # メモリ上限を 512MiB にロールバック (DOWN)
#   ./20251115T0001_update_cloudrun_memory_for_resize_image.sh down <SERVICE_NAME> <REGION> [PROJECT_ID]
#
#   例:
#     # dev 環境
#     ./20251115T0001_update_cloudrun_memory_for_resize_image.sh up   api-development asia-northeast1 food-scroll
#     ./20251115T0001_update_cloudrun_memory_for_resize_image.sh down api-development asia-northeast1 food-scroll
#
#     # prod 環境
#     ./20251115T0001_update_cloudrun_memory_for_resize_image.sh up   api-production  asia-northeast1 food-scroll
#     ./20251115T0001_update_cloudrun_memory_for_resize_image.sh down api-production  asia-northeast1 food-scroll
#
#   ※ PROJECT_ID を省略した場合は、gcloud のデフォルトプロジェクトが使用されます。
#   ※ 事前に `gcloud auth login` 等で認証済みであることを前提とします。
#

set -euo pipefail

print_usage() {
  # ファイル先頭のコメントを usage として表示
  sed -n '1,140p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-}"
SERVICE_NAME="${2:-}"
REGION="${3:-}"
PROJECT_ID="${4:-}"

if [[ -z "$MODE" || -z "$SERVICE_NAME" || -z "$REGION" ]]; then
  echo "引数が不足しています。" >&2
  echo >&2
  print_usage
  exit 1
fi

# gcloud 共通オプションの組み立て
GCLOUD_CMD=(gcloud run services update "$SERVICE_NAME" "--region=$REGION")

if [[ -n "${PROJECT_ID}" ]]; then
  GCLOUD_CMD+=("--project=${PROJECT_ID}")
fi

case "$MODE" in
  up)
    echo "🟦 Cloud Run Memory Update (UP) 開始..."
    echo "  - service : ${SERVICE_NAME}"
    echo "  - region  : ${REGION}"
    if [[ -n "${PROJECT_ID}" ]]; then
      echo "  - project : ${PROJECT_ID}"
    else
      echo "  - project : (gcloud デフォルトを使用)"
    fi
    echo "  - memory  : 1Gi"
    echo

    "${GCLOUD_CMD[@]}" --memory=1Gi

    echo
    echo "✅ UP 完了: memory=1Gi に更新しました"
    ;;

  down)
    echo "🟥 Cloud Run Memory Rollback (DOWN) 開始..."
    echo "  - service : ${SERVICE_NAME}"
    echo "  - region  : ${REGION}"
    if [[ -n "${PROJECT_ID}" ]]; then
      echo "  - project : ${PROJECT_ID}"
    else
      echo "  - project : (gcloud デフォルトを使用)"
    fi
    echo "  - memory  : 512MiB (rollback)"
    echo

    "${GCLOUD_CMD[@]}" --memory=512Mi

    echo
    echo "⏪ DOWN 完了: memory=512Mi に戻しました"
    ;;

  *)
    echo "MODE が不正です: ${MODE}" >&2
    echo "up または down を指定してください。" >&2
    echo >&2
    print_usage
    exit 1
    ;;
esac
