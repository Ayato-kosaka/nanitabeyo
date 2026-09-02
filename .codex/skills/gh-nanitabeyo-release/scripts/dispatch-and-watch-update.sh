#!/usr/bin/env bash
set -euo pipefail

# production EAS UpdateのGitHub Actionsを、確認済みのrelease SHAへ限定して実行する。
#
# 安全設計:
# - production専用の明示トークンがなければ何も変更しない。
# - release/*以外のrefを拒否し、main等からの誤配信を防ぐ。
# - 省略SHAを拒否し、ユーザーへ提示・確認したcommitを一意に固定する。
# - remote SHAが確認後に動いていれば実行しない。
# - workflowを実行した後はrun IDを特定し、成功・失敗が確定するまで監視する。
#
# このスクリプトは1ブランチだけを処理する。複数releaseを呼び出し側で逐次実行
# させることで、workflowが更新する共有EXPO_PUBLIC_COMMIT_IDの競合を防ぐ。

usage() {
  cat >&2 <<'EOF'
Usage:
  dispatch-and-watch-update.sh \
    --ref <release-branch> \
    --expected-sha <full-commit-sha> \
    --confirm-production CONFIRM_PRODUCTION

このコマンドはproductionのEAS Update workflowを実行し、完了まで監視します。
EOF
  exit 2
}

release_ref=
expected_sha=
confirmation=
workflow=eas-update.yml

# オプションを曖昧に推測しない。未知の引数や値不足はproduction実行前に拒否する。
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      [[ $# -ge 2 ]] || usage
      release_ref=$2
      shift 2
      ;;
    --expected-sha)
      [[ $# -ge 2 ]] || usage
      expected_sha=$2
      shift 2
      ;;
    --confirm-production)
      [[ $# -ge 2 ]] || usage
      confirmation=$2
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$release_ref" && -n "$expected_sha" ]] || usage

# ユーザーへSHA一覧を提示した後の明示確認を、呼び出し側が受け取ったことを示す
# 固定トークン。通常の実行では入力されない文字列にして、偶発実行を防ぐ。
if [[ "$confirmation" != "CONFIRM_PRODUCTION" ]]; then
  echo "production実行を停止しました: 明示的な確認トークンがありません。" >&2
  exit 3
fi
if [[ ! "$release_ref" =~ ^release/[A-Za-z0-9._/-]+$ ]]; then
  echo "production実行を停止しました: refには明示的なrelease/*ブランチが必要です。" >&2
  exit 3
fi
if [[ ! "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "production実行を停止しました: --expected-shaには40文字の完全SHAが必要です。" >&2
  exit 3
fi

git rev-parse --is-inside-work-tree >/dev/null
gh auth status >/dev/null

# local tracking refではなくoriginの実体を直接問い合わせる。fetch後にremoteが動いた
# 場合も検出でき、古いlocal SHAをproductionへ流す事故を防げる。
remote_line=$(git ls-remote --heads origin "refs/heads/${release_ref}")
remote_sha=$(awk 'NR == 1 { print $1 }' <<<"$remote_line")
if [[ -z "$remote_sha" ]]; then
  echo "production実行を停止しました: remoteブランチが見つかりません: $release_ref" >&2
  exit 4
fi
if [[ "$remote_sha" != "$expected_sha" ]]; then
  echo "production実行を停止しました: remote SHAが移動しています。" >&2
  printf '期待値: %s\n実際値: %s\n' "$expected_sha" "$remote_sha" >&2
  exit 4
fi

# 対象release refにworkflow定義が存在し、GitHubから参照可能なことをdispatch前に確認する。
gh workflow view "$workflow" --ref "$release_ref" --yaml >/dev/null

# gh workflow runはrun IDを直接返さない。そのためdispatch直前のUTC時刻を記録し、
# 同じbranch・workflow・head SHAかつ、この時刻以降に作られたrunだけを候補にする。
started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '%sを%sのSHA %sで実行します（channel=production）\n' \
  "$workflow" "$release_ref" "$expected_sha"
gh workflow run "$workflow" --ref "$release_ref" -f channel=production

run_json=
# GitHub側でworkflow_dispatch eventがrunとして一覧に現れるまで短時間pollする。
# head SHAと作成時刻を照合するため、過去の同一branch runを誤監視しない。
for attempt in $(seq 1 40); do
  run_json=$(
    gh run list \
      --workflow "$workflow" \
      --branch "$release_ref" \
      --event workflow_dispatch \
      --limit 30 \
      --json databaseId,headSha,status,conclusion,createdAt,url |
      python3 -c '
import json
import sys

expected_sha = sys.argv[1]
started_at = sys.argv[2]
runs = json.load(sys.stdin)
candidates = [
    run
    for run in runs
    if run.get("headSha") == expected_sha and run.get("createdAt", "") >= started_at
]
if candidates:
    print(json.dumps(sorted(candidates, key=lambda run: run["createdAt"])[-1], separators=(",", ":")))
' "$expected_sha" "$started_at"
  )
  if [[ -n "$run_json" ]]; then
    break
  fi
  printf 'workflow runの生成を待っています（%d/40）\n' "$attempt"
  sleep 3
done

if [[ -z "$run_json" ]]; then
  echo "workflowは実行されましたが、run IDを特定できませんでした。" >&2
  exit 5
fi

run_id=$(
  python3 -c 'import json, sys; print(json.load(sys.stdin)["databaseId"])' <<<"$run_json"
)
run_url=$(
  python3 -c 'import json, sys; print(json.load(sys.stdin)["url"])' <<<"$run_json"
)
printf 'Run ID: %s\nRun URL: %s\n' "$run_id" "$run_url"

# exit-statusによりworkflow失敗をスクリプト失敗として上位へ伝える。
# 失敗時はrun概要を追加表示するが、自動retryや後続releaseのdispatchは行わない。
if ! gh run watch "$run_id" --exit-status --interval 10; then
  echo "production EAS Update workflowが失敗しました。後続releaseを実行しないでください。" >&2
  gh run view "$run_id"
  exit 6
fi

# 呼び出し側が最終報告へそのまま利用できる、機密を含まないrun metadataだけを出力する。
gh run view "$run_id" --json databaseId,headSha,status,conclusion,createdAt,updatedAt,url
