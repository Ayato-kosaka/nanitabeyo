#!/usr/bin/env bash

# 変更チケット #767 Cloud Run にデプロイするたびに Artifact Registry のイメージが溜まって保管料が出ている
#
# ## 内容
# - Artifact Registry リポジトリへ cleanup policy を設定し、古いイメージが自動で消えるようにする。
#   - Keep  : 新しい方から 10 個（Keep は Delete より優先される）
#   - Delete: untagged なイメージのうち 7 日より古いもの
#   - Delete: tagged なイメージのうち 30 日より古いもの
#
# ## ⚠️ Keep だけでは 1 バイトも減らない（レビュー指摘）
# Artifact Registry の cleanup policy では、**削除するのは Delete 条件だけ**で、
# Keep は「Delete 条件に当たっても消さない」という保護にしかならない。
# したがって `mostRecentVersions.keepCount` を書いても 11 個目以降が消えるわけではない。
# `api-deploy.yml` は deploy のたびに `:${github.sha}` を付けた **tagged** イメージを push するので、
# tagged 側にも Delete 条件を置かないと、容量を食っている当のイメージが永久に残る。
#
# ## 背景
# - `.github/workflows/api-deploy.yml` は deploy のたびに `${ARTIFACT_REPO_URI}/api:${github.sha}`
#   を新しく push する。タグは commit SHA なので毎回別物になり、古いイメージは誰も消さない。
# - Cloud Run はリビジョンを digest で参照するため、ロールバック先のイメージが消えると戻せなくなる。
#   したがって「全部消す」ではなく「直近 N 世代を残す」方針にする。
#
# ## この方針で残るもの / 消えるもの
# - 残る: 直近 10 個のイメージ（= 直近 10 デプロイ分。ここまでロールバックできる）。
#         Keep が Delete より優先されるため、30 日より古くてもこの 10 個は消えない。
# - 消える: 直近 10 個に入らない tagged イメージのうち 30 日より古いもの、
#           および 7 日より古い untagged イメージ
#
# ## ⚠️ ロールバックできなくなるリスク
# - **11 世代より前かつ 30 日より古いものへは戻せなくなる。**
#   「半年前の状態へ戻す」運用をしているなら KEEP_COUNT か TAGGED_MAX_AGE を上げること。
# - **長期間デプロイしていない環境が危ない。** 例えば development ばかり 10 回以上デプロイし、
#   production は 30 日以上前のまま、という状態だと production の参照イメージが
#   「直近 10 個」から押し出され、Delete 条件にかかりうる。
#   本スクリプトは apply 前にこれを自動で照合して警告する（下の「保持対象の照合」）。
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
# tagged イメージを削除対象にする年齢。Keep（直近 KEEP_COUNT 個）が優先されるので、
# 「直近 10 個に入らず、かつ 30 日より古い」ものだけが実際に消える。
TAGGED_MAX_AGE="30d"

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
REFERENCED_IMAGES=()
for service in api-production api-development; do
  image="$(gcloud run services describe "${service}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
  if [[ -n "${image}" ]]; then
    echo "  ${service}: ${image}"
    REFERENCED_IMAGES+=("${service}=${image}")
  else
    echo "  ${service}: (取得できず。サービス名かリージョンを確認すること)"
  fi
done
echo

# ------------------------------------------------------------------
# 保持対象の照合
#
# Keep は「新しい方から KEEP_COUNT 個」なので、長期間デプロイしていない環境の
# 参照イメージは押し出されて Delete 条件（TAGGED_MAX_AGE より古い tagged）に
# かかりうる。目視だけに頼らず、ここで機械的に突き合わせて警告する。
#
# 照合は best-effort（タグ／digest の書式ゆれで空振りしうる）なので、
# 結果が取れなかった場合は「安全」と言い切らずその旨を出す。
# ------------------------------------------------------------------
KEEP_SET_WARNING=0
if [[ ${#REFERENCED_IMAGES[@]} -gt 0 ]]; then
  echo "--- 参照中イメージが「直近 ${KEEP_COUNT} 個」に入っているかを照合する ---"
  for entry in "${REFERENCED_IMAGES[@]}"; do
    service="${entry%%=*}"
    image="${entry#*=}"
    # Keep の keepCount はパッケージ単位で適用されるため、参照中イメージと同じ
    # パッケージだけを一覧する。REPO_URI 全体を渡すと別パッケージが混ざり、誤判定する。
    if [[ "${image}" == *"@"* ]]; then
      image_uri="${image%%@*}"
      key="${image##*@}"
    else
      image_uri="${image%:*}"
      key="${image##*:}"
    fi
    recent_versions="$(gcloud artifacts docker images list "${image_uri}" \
      --project="${PROJECT_ID}" \
      --include-tags \
      --sort-by='~UPDATE_TIME' \
      --limit="${KEEP_COUNT}" \
      --format='value(version,tags)' 2>/dev/null || true)"

    if [[ -z "${recent_versions}" ]]; then
      echo "  ⚠️ ${service}: イメージ一覧を取得できなかったため照合できない。手動で確認すること。"
      KEEP_SET_WARNING=1
    elif grep -qF -- "${key}" <<<"${recent_versions}"; then
      echo "  ✅ ${service}: 直近 ${KEEP_COUNT} 個に含まれる（Keep で保護される）"
    else
      echo "  ⚠️ ${service}: 直近 ${KEEP_COUNT} 個に **見つからない**（${key}）"
      echo "     この環境を長期間デプロイしていない場合、参照イメージが削除されてロールバックできなくなる。"
      echo "     KEEP_COUNT か TAGGED_MAX_AGE を上げるか、先に再デプロイしてから apply すること。"
      KEEP_SET_WARNING=1
    fi
  done
  echo
fi

if [[ "${ACTION}" == "remove" ]]; then
  echo "--- cleanup policy を削除する ---"
  gcloud artifacts repositories delete-cleanup-policies "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --policynames=keep-recent-releases,delete-old-untagged,delete-old-tagged
  echo "完了。既に削除されたイメージは戻らない点に注意。"
  exit 0
fi

# ------------------------------------------------------------------
# ポリシー定義
#   keep-recent-releases : 新しい方から KEEP_COUNT 個を保護する
#   delete-old-untagged  : untagged で UNTAGGED_MAX_AGE より古いものを削除
#   delete-old-tagged    : tagged で TAGGED_MAX_AGE より古いものを削除
#
# ⚠️ Keep は「削除しない」保護でしかなく、それ自体は何も消さない。
#    容量を食っているのは api-deploy が push する `:${github.sha}` の **tagged** イメージなので、
#    delete-old-tagged が無いとこのスクリプトは目的を果たさない（レビュー指摘）。
#    Keep は Delete より優先されるため、直近 KEEP_COUNT 個は年齢に関わらず残る。
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
  },
  {
    "name": "delete-old-tagged",
    "action": { "type": "Delete" },
    "condition": {
      "tagState": "tagged",
      "olderThan": "${TAGGED_MAX_AGE}"
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
  gcloud artifacts repositories set-cleanup-policies "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --policy="${POLICY_FILE}" \
    --dry-run

  echo
  echo "dry-run を登録した。何が削除対象になるかは Cloud Logging で確認すること:"
  echo "  resource.type=\"artifactregistry.googleapis.com/Repository\""
  echo "  jsonPayload.message=~\"cleanup\""
  echo
  echo "確認できたら 'apply' を実行すること（dry-run が解除され実削除が始まる）。"
  exit 0
fi

echo "--- 本適用する（実際に削除が始まる） ---"
if [[ "${KEEP_SET_WARNING}" -ne 0 ]]; then
  echo "⚠️ 上の照合で警告が出ている。参照中のイメージが消える可能性がある。"
  echo "   先に再デプロイするか、KEEP_COUNT / TAGGED_MAX_AGE を上げてからやり直すこと。"
fi
read -r -p "現在参照中の digest が保持対象に入っていることを確認したか? [yes/N] " answer
if [[ "${answer}" != "yes" ]]; then
  echo "中止した。"
  exit 1
fi

gcloud artifacts repositories set-cleanup-policies "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --policy="${POLICY_FILE}" \
  --no-dry-run

echo
echo "完了。反映まで数時間かかることがある。"
echo "現在のポリシーは次で確認できる:"
echo "  gcloud artifacts repositories describe ${REPO_NAME} --project=${PROJECT_ID} --location=${REGION}"
