#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create-gcs-bucket.sh
# ------------------------------------------------------------------------------
# 目的:
#   - 指定の GCS バケットを冪等に作成/更新する。
#   - 作成時に Location / Storage Class / Uniform Bucket-Level Access を設定。
#   - 既存の場合は可能な範囲で設定を整える（UBLA, PAP, ラベル等）。
#
# 使い方:
#   chmod +x create-gcs-bucket.sh
#   ./create-gcs-bucket.sh <BUCKET_NAME> <REGION> <STORAGE_CLASS> <UNIFORM_ACCESS>
#
# 引数:
#   BUCKET_NAME     : バケット名（例: nanitabeyo-public）
#   REGION          : リージョン（例: asia-northeast1）
#   STORAGE_CLASS   : ストレージクラス（例: STANDARD / NEARLINE / COLDLINE / ARCHIVE）
#   UNIFORM_ACCESS  : UBLA を有効化するか（true/false）
#
# 環境変数(任意):
#   GCP_PROJECT                 : 明示的にプロジェクトを指定 (未指定なら gcloud の現在値)
#   LABELS                      : 付与するラベル（例: "env=prod,owner=media"）
#   PUBLIC_ACCESS_PREVENTION    : "enforced" (既定) or "unspecified"
#   VERSIONING                  : "true" ならバージョニング有効化
#   LOGGING_BUCKET              : アクセスログ出力先バケット (gs:// なしのバケット名)
#   LOGGING_PREFIX              : ログのプレフィックス（例: access-logs/）
#
# 依存:
#   - gcloud CLI (storage コマンド)
#   - 権限: storage.admin 以上を推奨
# ------------------------------------------------------------------------------

set -euo pipefail

BUCKET_NAME="${1:-}"
REGION="${2:-}"
STORAGE_CLASS="${3:-}"
UNIFORM_ACCESS="${4:-}"

if [[ -z "${BUCKET_NAME}" || -z "${REGION}" || -z "${STORAGE_CLASS}" || -z "${UNIFORM_ACCESS}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <BUCKET_NAME> <REGION> <STORAGE_CLASS> <UNIFORM_ACCESS>"
  exit 1
fi

# Optional settings with safe defaults
PAP_MODE="${PUBLIC_ACCESS_PREVENTION:-enforced}"   # enforced / unspecified
LABELS_OPT="${LABELS:-}"
VERSIONING_OPT="${VERSIONING:-false}"
LOG_BUCKET="${LOGGING_BUCKET:-}"
LOG_PREFIX="${LOGGING_PREFIX:-}"

PROJECT="${GCP_PROJECT:-}"
if [[ -n "${PROJECT}" ]]; then
  gcloud config set project "${PROJECT}" >/dev/null
fi

DATE_TAG="$(date +%Y%m%d-%H%M%S)"
echo "▶️  BUCKET_NAME   : ${BUCKET_NAME}"
echo "▶️  REGION        : ${REGION}"
echo "▶️  STORAGE_CLASS : ${STORAGE_CLASS}"
echo "▶️  UNIFORM_ACCESS: ${UNIFORM_ACCESS}"
echo "▶️  PROJECT       : $(gcloud config get-value project 2>/dev/null)"
echo "▶️  PAP           : ${PAP_MODE}"
echo "▶️  LABELS        : ${LABELS_OPT:-<none>}"
echo "▶️  VERSIONING    : ${VERSIONING_OPT}"
echo "▶️  LOGGING       : ${LOG_BUCKET:-<none>} (prefix: ${LOG_PREFIX:-<none>})"
echo "────────────────────────────────────────────────────────"

# 必要 API（idempotent）
echo "🔧 Enabling Storage API (idempotent)…"
gcloud services enable storage.googleapis.com --quiet

EXISTS=false
if gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  EXISTS=true
  echo "ℹ️  既存バケットを検出: gs://${BUCKET_NAME}"
else
  echo "🪣 バケットが存在しないため作成します: gs://${BUCKET_NAME}"
fi

if [[ "${EXISTS}" == "false" ]]; then
  # 作成 (location / class / UBLA)
  CMD=(gcloud storage buckets create "gs://${BUCKET_NAME}" --location="${REGION}" --default-storage-class="${STORAGE_CLASS}")
  if [[ "${UNIFORM_ACCESS}" == "true" ]]; then
    CMD+=(--uniform-bucket-level-access)
  fi
  # PAP
  if [[ "${PAP_MODE}" == "enforced" ]]; then
    CMD+=(--public-access-prevention)
  fi
  # ラベル
  if [[ -n "${LABELS_OPT}" ]]; then
    CMD+=(--labels="${LABELS_OPT}")
  fi
  echo "+ ${CMD[*]}"
  "${CMD[@]}"

  # バージョニング
  if [[ "${VERSIONING_OPT}" == "true" ]]; then
    echo "🔁 有効化: Object Versioning"
    gcloud storage buckets update "gs://${BUCKET_NAME}" --versioning --quiet
  fi

  # ログ設定
  if [[ -n "${LOG_BUCKET}" ]]; then
    echo "📝 ログ出力設定: gs://${LOG_BUCKET} (prefix: ${LOG_PREFIX})"
    gcloud storage buckets update "gs://${BUCKET_NAME}" \
      --log-bucket="gs://${LOG_BUCKET}" \
      --log-object-prefix="${LOG_PREFIX}" \
      --quiet
  fi

else
  # 既存: 変更可能な設定のみ調整
  echo "🔄 既存バケット設定の調整を行います（変更不可項目は警告のみ）"

  # 現在のメタ
  CUR_LOC="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='value(location)')"
  CUR_CLASS="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='value(storageClass)')"
  CUR_PAP="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='value(iamConfiguration.publicAccessPrevention)')"
  CUR_UBLA="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='value(iamConfiguration.uniformBucketLevelAccess.enabled)')"

  if [[ "${CUR_LOC}" != "${REGION}" ]]; then
    echo "⚠️  Location は作成後に変更できません。現在: ${CUR_LOC} / 要求: ${REGION}"
  fi
  if [[ "${CUR_CLASS}" != "${STORAGE_CLASS}" ]]; then
    echo "⚠️  Storage Class はバケット単位では変更不可です（オブジェクト単位で有効）。現在: ${CUR_CLASS} / 期待: ${STORAGE_CLASS}"
  fi

  # UBLA
  if [[ "${UNIFORM_ACCESS}" == "true" && "${CUR_UBLA}" != "True" ]]; then
    echo "🔐 UBLA を有効化します"
    gcloud storage buckets update "gs://${BUCKET_NAME}" --uniform-bucket-level-access --quiet
  elif [[ "${UNIFORM_ACCESS}" == "false" && "${CUR_UBLA}" == "True" ]]; then
    echo "ℹ️  UBLA は無効化も可能ですが非推奨のため変更しません（必要なら明示的に手動で）。"
  fi

  # PAP
  if [[ "${PAP_MODE}" == "enforced" && "${CUR_PAP}" != "enforced" ]]; then
    echo "🛡  Public Access Prevention を enforced に設定します"
    gcloud storage buckets update "gs://${BUCKET_NAME}" --public-access-prevention --quiet
  elif [[ "${PAP_MODE}" == "unspecified" && "${CUR_PAP}" == "enforced" ]]; then
    echo "ℹ️  PAP を unspecified に戻すことは可能ですが安全のため維持します（必要なら明示的に）。"
  fi

  # ラベル更新（追加/上書き）
  if [[ -n "${LABELS_OPT}" ]]; then
    echo "🏷  ラベル更新: ${LABELS_OPT}"
    gcloud storage buckets update "gs://${BUCKET_NAME}" --add-labels="${LABELS_OPT}" --quiet || true
  fi

  # バージョニング
  if [[ "${VERSIONING_OPT}" == "true" ]]; then
    echo "🔁 有効化: Object Versioning"
    gcloud storage buckets update "gs://${BUCKET_NAME}" --versioning --quiet
  fi

  # ログ設定
  if [[ -n "${LOG_BUCKET}" ]]; then
    echo "📝 ログ出力設定: gs://${LOG_BUCKET} (prefix: ${LOG_PREFIX})"
    gcloud storage buckets update "gs://${BUCKET_NAME}" \
      --log-bucket="gs://${LOG_BUCKET}" \
      --log-object-prefix="${LOG_PREFIX}" \
      --quiet
  fi
fi

# 結果の要約
echo "✅ 完了: gs://${BUCKET_NAME}"
gcloud storage buckets describe "gs://${BUCKET_NAME}" --format='yaml(name,location,storageClass,iamConfiguration,labels)'
