#!/usr/bin/env bash

# 変更チケット #767 Cloud Run にデプロイするたびに Artifact Registry のイメージが溜まって保管料が出ている
#
# ## 内容
# - Artifact Registry リポジトリへ cleanup policy を設定し、古いイメージが自動で消えるようにする。
#   - Keep  : tagged なイメージを新しい方から 10 個
#   - Delete: untagged なイメージのうち 7 日より古いもの
#
# ## 背景
# - `.github/workflows/api-deploy.yml` は deploy のたびに `${ARTIFACT_REPO_URI}/api:${github.sha}`
#   を新しく push する。タグは commit SHA なので毎回別物になり、古いイメージは誰も消さない。
# - Cloud Run はリビジョンを digest で参照するため、ロールバック先のイメージが消えると戻せなくなる。
#   したがって「全部消す」ではなく「直近 N 世代を残す」方針にする。
#
# ## この方針で残るもの / 消えるもの
# - 残る: 直近 10 個の tagged イメージ（= 直近 10 デプロイ分。ここまでロールバックできる）
# - 消える: 11 個目より古い tagged イメージ、および 7 日より古い untagged イメージ
#
# ## ⚠️ ロールバックできなくなるリスク
# - **11 世代より前へは戻せなくなる。** 「半年前の状態へ戻す」運用をしているなら KEEP_COUNT を上げること。
# - Cloud Run のリビジョンが参照している digest は untagged に見えることがある。
#   本スクリプトは実行前に **現在参照中の digest を必ず表示する**ので、
#   それが保持対象に入っていることを目で確認してから apply すること。
# - cleanup policy の削除は非同期で、反映までにラグがある（数時間かかることがある）。
#
# ## 使い方
#   # 1. まず現在の参照状況と、ポリシーが何を消すかを確認する（何も変更しない）
#   ./setup_artifact_registry_cleanup_policy.sh dryrun <REPO_URI> <REGION> [PROJECT_ID]
#
#   # 2. 内容に納得したら適用する
#   ./setup_artifact_registry_cleanup_policy.sh apply  <REPO_URI> <REGION> [PROJECT_ID]
#
#   # 3. 元に戻す（ポリシーを外す。既に消えたイメージは戻らない）
#   ./setup_artifact_registry_cleanup_policy.sh remove <REPO_URI> <REGION> [PROJECT_ID]
#
# ## 引数
# - REPO_URI : GitHub Actions の Repository variable `ARTIFACT_REPO_URI` と同じ値。
#              例) asia-northeast1-docker.pkg.dev/food-scroll/api-repo
#              ※ このリポジトリでは workflow が vars 経由で参照しているため、
#                 リテラル値はコードに存在しない。Settings → Variables で確認すること。
# - REGION   : Repository variable `CLOUD_RUN_REGION` と同じ値。例) asia-northeast1
# - PROJECT_ID : 省略時は gcloud の現在の設定を使う
#
# ## 事前条件
# - `roles/artifactregistry.admin` 相当の権限が要る。
# - `dryrun` は Artifact Registry の公式 dry-run 機能を使う。
#   ポリシーを保存せずに「何が消えるか」だけを出力する。

set -euo pipefail

ACTION="${1:-}"
REPO_URI="${2:-}"
REGION="${3:-}"
PROJECT_ID="${4:-$(gcloud config get-value project 2>/dev/null || true)}"

KEEP_COUNT=10
UNTAGGED_MAX_AGE="7d"

usage() {
  echo "Usage: $0 {dryrun|apply|remove} <REPO_URI> <REGION> [PROJECT_ID]" >&2
  echo "  REPO_URI 例: asia-northeast1-docker.pkg.dev/food-scroll/api-repo" >&2
  exit 1
}

case "${ACTION}" in
  dryrun | apply | remove) ;;
  *) usage ;;
esac

if [[ -z "${REPO_URI}" || -z "${REGION}" ]]; then
  usage
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: PROJECT_ID を解決できない。引数で渡すか gcloud config set project を実行すること。" >&2
  exit 1
fi

# REPO_URI は "<region>-docker.pkg.dev/<project>/<repo>" 形式。末尾のリポジトリ名だけを取り出す。
REPO_NAME="${REPO_URI##*/}"
if [[ -z "${REPO_NAME}" || "${REPO_NAME}" == "${REPO_URI}" ]]; then
  echo "ERROR: REPO_URI からリポジトリ名を取り出せない: ${REPO_URI}" >&2
  echo "       'asia-northeast1-docker.pkg.dev/<project>/<repo>' の形式で渡すこと。" >&2
  exit 1
fi

echo "=============================================="
echo " project : ${PROJECT_ID}"
echo " region  : ${REGION}"
echo " repo    : ${REPO_NAME}  (${REPO_URI})"
echo " action  : ${ACTION}"
echo "=============================================="
echo

# ------------------------------------------------------------------
# 消してはいけない digest を先に見せる。
# Cloud Run のリビジョンが参照しているイメージが消えると、そこへ戻せなくなる。
# ------------------------------------------------------------------
echo "--- 現在 Cloud Run が参照しているイメージ（消してはいけないもの） ---"
for service in api-production api-development; do
  image="$(gcloud run services describe "${service}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
  if [[ -n "${image}" ]]; then
    echo "  ${service}: ${image}"
  else
    echo "  ${service}: (取得できず。サービス名かリージョンを確認すること)"
  fi
done
echo

if [[ "${ACTION}" == "remove" ]]; then
  echo "--- cleanup policy を削除する ---"
  gcloud artifacts repositories update "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --clear-cleanup-policies
  echo "完了。既に削除されたイメージは戻らない点に注意。"
  exit 0
fi

# ------------------------------------------------------------------
# ポリシー定義
#   keep-recent-releases : tagged を新しい方から KEEP_COUNT 個保持
#   delete-old-untagged  : untagged で UNTAGGED_MAX_AGE より古いものを削除
# Keep は Delete より優先されるため、保持対象が消されることはない。
# ------------------------------------------------------------------
POLICY_FILE="$(mktemp -t artifact-cleanup-policy.XXXXXX.json)"
trap 'rm -f "${POLICY_FILE}"' EXIT

cat >"${POLICY_FILE}" <<EOF
[
  {
    "name": "keep-recent-releases",
    "action": { "type": "Keep" },
    "mostRecentVersions": {
      "keepCount": ${KEEP_COUNT}
    }
  },
  {
    "name": "delete-old-untagged",
    "action": { "type": "Delete" },
    "condition": {
      "tagState": "untagged",
      "olderThan": "${UNTAGGED_MAX_AGE}"
    }
  }
]
EOF

echo "--- 適用するポリシー ---"
cat "${POLICY_FILE}"
echo

if [[ "${ACTION}" == "dryrun" ]]; then
  # --dry-run はポリシーを保存し、削除は行わずログにのみ出力するモード。
  # 効果を確かめてから apply へ進むこと。
  echo "--- dry-run で登録する（削除は行われない） ---"
  gcloud artifacts repositories update "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --cleanup-policy-file="${POLICY_FILE}" \
    --cleanup-policy-dry-run

  echo
  echo "dry-run を登録した。何が削除対象になるかは Cloud Logging で確認すること:"
  echo "  resource.type=\"artifactregistry.googleapis.com/Repository\""
  echo "  jsonPayload.message=~\"cleanup\""
  echo
  echo "確認できたら 'apply' を実行すること（dry-run が解除され実削除が始まる）。"
  exit 0
fi

echo "--- 本適用する（実際に削除が始まる） ---"
read -r -p "現在参照中の digest が保持対象に入っていることを確認したか? [yes/N] " answer
if [[ "${answer}" != "yes" ]]; then
  echo "中止した。"
  exit 1
fi

gcloud artifacts repositories update "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --cleanup-policy-file="${POLICY_FILE}" \
  --no-cleanup-policy-dry-run

echo
echo "完了。反映まで数時間かかることがある。"
echo "現在のポリシーは次で確認できる:"
echo "  gcloud artifacts repositories describe ${REPO_NAME} --project=${PROJECT_ID} --location=${REGION}"
