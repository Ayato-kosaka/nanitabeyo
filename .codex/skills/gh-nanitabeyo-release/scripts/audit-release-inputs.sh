#!/usr/bin/env bash
set -euo pipefail

# フルリリースのGo/No-Go判断に必要なGit上の材料を、2つの不変refから収集する。
# safe/requiredを自動決定せず、secretやfile本文を出力しない。

usage() {
  echo "Usage: $0 <source-ref> <previous-release-ref>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
source_ref=$1
previous_ref=$2

git rev-parse --is-inside-work-tree >/dev/null

resolve_commit() {
  local ref=$1
  git rev-parse --verify "${ref}^{commit}" 2>/dev/null ||
    git rev-parse --verify "origin/${ref}^{commit}" 2>/dev/null
}

source_sha=$(resolve_commit "$source_ref") || {
  echo "source refを解決できません: $source_ref" >&2
  exit 1
}
previous_sha=$(resolve_commit "$previous_ref") || {
  echo "previous release refを解決できません: $previous_ref" >&2
  exit 1
}
merge_base=$(git merge-base "$source_sha" "$previous_sha")
counts=$(git rev-list --left-right --count "${previous_sha}...${source_sha}")

json_value() {
  local commit=$1
  local path=$2
  local key=$3
  git show "${commit}:${path}" 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$key" 2>/dev/null ||
    printf '%s\n' '<missing>'
}

source_version=$(json_value "$source_sha" app-expo/package.json version)
previous_version=$(json_value "$previous_sha" app-expo/package.json version)

printf 'Release監査入力\n'
printf 'source: %s (%s)\n' "$source_ref" "$source_sha"
printf 'previous: %s (%s)\n' "$previous_ref" "$previous_sha"
printf 'merge-base: %s\n' "$merge_base"
printf 'previousのみ/sourceのみのcommit数: %s\n' "$counts"
printf 'source app version: %s\n' "$source_version"
printf 'previous app version: %s\n' "$previous_version"

echo
echo 'sourceに含まれるcommit（最大200件）'
git log --format='%h%x09%s' --no-merges "${merge_base}..${source_sha}" | sed -n '1,200p'

print_changed_paths() {
  local heading=$1
  shift
  echo
  echo "$heading"
  local paths
  paths=$(git diff --name-status "$previous_sha" "$source_sha" -- "$@" | sed -n '1,240p')
  if [[ -n "$paths" ]]; then
    printf '%s\n' "$paths"
  else
    echo '<変更なし>'
  fi
}

print_changed_paths 'Native影響候補' \
  app-expo/package.json app-expo/app.json 'app-expo/app.config.*' app-expo/eas.json \
  app-expo/ios app-expo/android app-expo/plugins app-expo/assets pnpm-lock.yaml patches

print_changed_paths 'API/shared contract影響候補' \
  api shared/api shared/package.json shared/prisma/package.json Dockerfile 'api/**/Dockerfile*' pnpm-lock.yaml

print_changed_paths 'DB schema migration候補' \
  infra/supabase/migrations shared/prisma/schema.prisma scripts/apply-migration.sh

print_changed_paths 'Data migration・backfill・catalog・seed候補' \
  scripts infra 'docs/**/*RUNBOOK*' 'docs/**/*runbook*'

print_changed_paths 'Web配信影響候補' \
  'app-expo/**/*.web.*' app-expo/app app-expo/components app-expo/features app-expo/assets \
  firebase.json scripts/gen-sitemap.mjs e2e-web shared

print_changed_paths 'Release workflow変更' .github/workflows \
  .github/workflows/eas-build-submit-prod.yml \
  .github/workflows/api-deploy.yml \
  .github/workflows/firebase-hosting-deploy.yml \
  .github/workflows/eas-update.yml

echo
echo '対象source SHA上の必須workflow'
for workflow in \
  .github/workflows/eas-build-submit-prod.yml \
  .github/workflows/api-deploy.yml \
  .github/workflows/firebase-hosting-deploy.yml \
  .github/workflows/eas-update.yml; do
  if git cat-file -e "${source_sha}:${workflow}" 2>/dev/null; then
    printf 'present\t%s\n' "$workflow"
  else
    printf 'missing\t%s\n' "$workflow"
  fi
done

echo
echo 'この出力だけで配信要否や実行順を決定しないでください。'
echo 'linked issue/PR、実行時到達性、API後方互換性、手動data operation、実配布native buildを追加確認してください。'
