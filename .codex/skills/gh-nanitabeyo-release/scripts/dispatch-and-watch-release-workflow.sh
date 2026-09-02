#!/usr/bin/env bash
set -euo pipefail

# 承認済みSHAに限定して、native/API/Webのproduction workflowを1件dispatchし、
# GitHub Actionsのterminal stateまで監視する。EASの非同期build/submissionは別途監視する。

usage() {
  cat >&2 <<'EOF'
Usage:
  dispatch-and-watch-release-workflow.sh \
    --kind <native|api|web> \
    --ref <deploy-branch> \
    --expected-sha <full-commit-sha> \
    [--platform <all|ios|android>] \
    --confirm-production CONFIRM_PRODUCTION

--ref に渡すブランチは面ごとに違う。正本は docs/specs/deploy-branches.md。
  native  release/X.Y
  api     release/X.Y
  web     web
EOF
  exit 2
}

kind=
release_ref=
expected_sha=
platform=all
confirmation=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind)
      [[ $# -ge 2 ]] || usage
      kind=$2
      shift 2
      ;;
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
    --platform)
      [[ $# -ge 2 ]] || usage
      platform=$2
      shift 2
      ;;
    --confirm-production)
      [[ $# -ge 2 ]] || usage
      confirmation=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ -n "$kind" && -n "$release_ref" && -n "$expected_sha" ]] || usage
[[ "$confirmation" == CONFIRM_PRODUCTION ]] || {
  echo 'production実行を停止しました: 明示確認トークンがありません。' >&2
  exit 3
}
# #1783 【設計】デプロイ元ブランチは面ごとに違う。正本は docs/specs/deploy-branches.md。
#
# ここを `release/*` 一律にしていたため、web を正しい `web` ブランチから出そうとしても
# script が弾き、native のリリース作業の流れでそのまま release ブランチから
# 本番 web が出ていた（2026-09-02 に発覚。`web` は 6 週間更新が止まっていた）。
#
# ⚠️ 面を増やす・ref を変えるときは **先に docs/specs/deploy-branches.md を直す。**
#    ここは表の写しではなく、その表を機械的に強制する唯一の場所である。
expected_ref_pattern() {
  case "$1" in
    native) printf '^release/[A-Za-z0-9._/-]+$' ;;
    web) printf '^web$' ;;
    api) printf '^release/[A-Za-z0-9._/-]+$' ;;
    *) return 1 ;;
  esac
}

ref_pattern=$(expected_ref_pattern "$kind") || usage
[[ "$release_ref" =~ $ref_pattern ]] || {
  printf 'production実行を停止しました: --kind %s のデプロイ元は %s です（渡された ref: %s）。\n' \
    "$kind" "$ref_pattern" "$release_ref" >&2
  echo '正本: docs/specs/deploy-branches.md' >&2
  exit 3
}
[[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]] || {
  echo 'production実行を停止しました: 40文字の完全SHAが必要です。' >&2
  exit 3
}
[[ "$platform" =~ ^(all|ios|android)$ ]] || usage

case "$kind" in
  native)
    workflow=eas-build-submit-prod.yml
    dispatch_args=(-f "platform=${platform}")
    ;;
  api)
    workflow=api-deploy.yml
    dispatch_args=(-f target=production)
    [[ "$platform" == all ]] || {
      echo '--platformはnativeだけで使用できます。' >&2
      exit 2
    }
    ;;
  web)
    workflow=firebase-hosting-deploy.yml
    dispatch_args=(-f target=production)
    [[ "$platform" == all ]] || {
      echo '--platformはnativeだけで使用できます。' >&2
      exit 2
    }
    ;;
  *) usage ;;
esac

git rev-parse --is-inside-work-tree >/dev/null
gh auth status >/dev/null

remote_line=$(git ls-remote --heads origin "refs/heads/${release_ref}")
remote_sha=$(awk 'NR == 1 { print $1 }' <<<"$remote_line")
[[ -n "$remote_sha" ]] || {
  echo "remote branchが見つかりません: $release_ref" >&2
  exit 4
}
[[ "$remote_sha" == "$expected_sha" ]] || {
  echo 'production実行を停止しました: remote SHAが移動しています。' >&2
  printf '期待値: %s\n実際値: %s\n' "$expected_sha" "$remote_sha" >&2
  exit 4
}

git cat-file -e "${expected_sha}:.github/workflows/${workflow}" 2>/dev/null || {
  echo "対象SHAにworkflowがありません: $workflow" >&2
  exit 4
}
gh workflow view "$workflow" --ref "$release_ref" --yaml >/dev/null

started_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
printf '%sを%s (%s)でproduction実行します。\n' "$workflow" "$release_ref" "$expected_sha"
gh workflow run "$workflow" --ref "$release_ref" "${dispatch_args[@]}"

run_json=
for attempt in $(seq 1 40); do
  run_json=$(
    gh run list \
      --workflow "$workflow" \
      --branch "$release_ref" \
      --event workflow_dispatch \
      --limit 30 \
      --json databaseId,headSha,status,conclusion,createdAt,url |
      python3 -c '
import json, sys
sha, started = sys.argv[1:]
runs = json.load(sys.stdin)
candidates = [r for r in runs if r.get("headSha") == sha and r.get("createdAt", "") >= started]
if candidates:
    print(json.dumps(sorted(candidates, key=lambda r: r["createdAt"])[-1], separators=(",", ":")))
' "$expected_sha" "$started_at"
  )
  [[ -n "$run_json" ]] && break
  printf 'workflow runの生成を待っています（%d/40）\n' "$attempt"
  sleep 3
done

[[ -n "$run_json" ]] || {
  echo 'workflowはdispatchされましたがrun IDを特定できませんでした。再dispatchしないでください。' >&2
  exit 5
}

run_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["databaseId"])' <<<"$run_json")
run_url=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])' <<<"$run_json")
printf 'Run ID: %s\nRun URL: %s\n' "$run_id" "$run_url"

if ! gh run watch "$run_id" --exit-status --interval 10; then
  echo 'production workflowが失敗しました。後続を実行しないでください。' >&2
  gh run view "$run_id"
  exit 6
fi

gh run view "$run_id" --json databaseId,headSha,status,conclusion,createdAt,updatedAt,url

if [[ "$kind" == native ]]; then
  echo '注意: Actions完了はEAS build/submission完了を意味しません。platformごとのEAS terminal stateを確認してください。'
fi
