#!/usr/bin/env bash

# 変更チケット #431 Cloud Run のインスタンス制御変更 (max-instances=8, concurrency=80)
#
# ## 内容
# - Cloud Run サービスのスケーリング設定を変更し、
#   Supabase Free プランの接続上限到達を回避する。
#
# ## 背景
# - 本番環境で画像リサイズジョブ処理のスパイク時にインスタンス数が 16 を超過し、
#   Supabase Free プランの最大コネクション数 16 に到達し DB 接続エラーが発生した。
# - max-instances 上限と concurrency 設定を調整し、インスタンス数の暴走を防ぐ。
#
# ## 対応
# - max-instances を 20 → 8 に変更
# - concurrency を 80 (維持)
#
# ## ロールバック
# - max-instances を 20 に戻す (暫定)
#
# ## 使い方
#   # スケーリング設定を適用 (UP)
#   ./20251115T0000_update_cloudrun_scaling.sh up   <SERVICE_NAME> <REGION> [PROJECT_ID]
#
#   # ロールバック (DOWN)
#   ./20251115T0000_update_cloudrun_scaling.sh down <SERVICE_NAME> <REGION> [PROJECT_ID]
#
#   例:
#     # 本番 (プロジェクト指定あり)
#     ./20251115T0000_update_cloudrun_scaling.sh up   my-service asia-northeast1 my-prod-project
#     ./20251115T0000_update_cloudrun_scaling.sh down my-service asia-northeast1 my-prod-project
#
#     # dev (gcloud のデフォルトプロジェクトを使用)
#     ./20251115T0000_update_cloudrun_scaling.sh up   my-service-dev asia-northeast1
#
# ※ 注意:
#   - gcloud にログイン済みであること
#   - PROJECT_ID を省略した場合、gcloud のデフォルトプロジェクトが使われます
#

set -euo pipefail

print_usage() {
  sed -n '1,120p' "$0" | grep -E '^#' | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

MODE="${1:-}"
SERVICE_NAME="${2:-}"
REGION="${3:-}"
PROJECT_ID="${4:-:-}"

if [[ -z "$MODE" || -z "$SERVICE_NAME" || -z "$REGION" ]]; then
  echo "引数が不足しています。" >&2
  echo >&2
  print_usage
  exit 1
fi

# gcloud 共通オプションの組み立て
GCLOUD_CMD=(gcloud run services update "$SERVICE_NAME" "--region=$REGION")

if [[ "${PROJECT_ID}" != ":-" && -n "${PROJECT_ID}" ]]; then
  GCLOUD_CMD+=("--project=${PROJECT_ID}")
fi

case "$MODE" in
  up)
    echo "🟦 Cloud Run Scaling Update (UP) 開始..."
    echo "  - service      : ${SERVICE_NAME}"
    echo "  - region       : ${REGION}"
    if [[ "${PROJECT_ID}" != ":-" && -n "${PROJECT_ID}" ]]; then
      echo "  - project      : ${PROJECT_ID}"
    else
      echo "  - project      : (gcloud デフォルトを使用)"
    fi
    echo "  - max-instances: 8"
    echo "  - concurrency  : 80"
    echo

    "${GCLOUD_CMD[@]}" \
      --concurrency=80 \
      --max-instances=8

    echo
    echo "✅ UP 完了: max-instances=8 / concurrency=80 に更新しました"
    ;;

  down)
    echo "🟥 Cloud Run Scaling Rollback (DOWN) 開始..."
    echo "  - service      : ${SERVICE_NAME}"
    echo "  - region       : ${REGION}"
    if [[ "${PROJECT_ID}" != ":-" && -n "${PROJECT_ID}" ]]; then
      echo "  - project      : ${PROJECT_ID}"
    else
      echo "  - project      : (gcloud デフォルトを使用)"
    fi
    echo "  - max-instances: 20 (rollback)"
    echo "  - concurrency  : 80"
    echo

    "${GCLOUD_CMD[@]}" \
      --concurrency=80 \
      --max-instances=20

    echo
    echo "⏪ DOWN 完了: max-instances=20 / concurrency=80 に戻しました"
    ;;

  *)
    echo "MODE が不正です: ${MODE}" >&2
    echo "up または down を指定してください。" >&2
    echo >&2
    print_usage
    exit 1
    ;;
esac
