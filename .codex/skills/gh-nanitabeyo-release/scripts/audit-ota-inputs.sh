#!/usr/bin/env bash
set -euo pipefail

# OTA互換性の「判定材料」を、2つのGit refから読み取り専用で収集する。
#
# このスクリプト自身はsafe/unsafeを決定しない。ネイティブ互換性は、実際に
# productionへ配布されたEAS build、環境変数で変化するExpo config、JSからの
# ネイティブmodule参照を合わせて判断する必要があり、機械的なパス差分だけでは
# 確定できないためである。
#
# 注意:
# - git fetchは呼び出し元で済ませる。監査中にrefが動くことを避けるためである。
# - worktree、index、ブランチを変更しない。
# - Expo configやfingerprintのdebug出力はsecretを含み得るため生成しない。

usage() {
  echo "使用方法: $0 <ソースref> <対象ref>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage

source_ref=$1
target_ref=$2

# リポジトリ外から誤実行した場合は、曖昧な結果を出さず直ちに終了する。
git rev-parse --is-inside-work-tree >/dev/null

# origin/release/X.Yのような完全refと、release/X.Yのような短縮refの両方を
# 受け付ける。ただし戻り値は必ず不変のcommit SHAに固定する。
resolve_commit() {
  local ref=$1
  git rev-parse --verify "${ref}^{commit}" 2>/dev/null ||
    git rev-parse --verify "origin/${ref}^{commit}" 2>/dev/null
}

source_sha=$(resolve_commit "$source_ref") || {
  echo "ソースrefを解決できません: $source_ref" >&2
  exit 1
}
target_sha=$(resolve_commit "$target_ref") || {
  echo "対象refを解決できません: $target_ref" >&2
  exit 1
}
merge_base=$(git merge-base "$source_sha" "$target_sha")
counts=$(git rev-list --left-right --count "${target_sha}...${source_sha}")

# package.jsonが存在しない古いrefや壊れたJSONでも、監査レポート全体は継続する。
# "<missing>"はsafeを意味せず、呼び出し側がunknownとして扱うための信号である。
show_json_value() {
  local commit=$1
  local path=$2
  local key=$3
  git show "${commit}:${path}" 2>/dev/null |
    python3 -c '
import json
import sys

document = json.load(sys.stdin)
print(document.get(sys.argv[1], "<missing>"))
' "$key" 2>/dev/null ||
    printf '%s\n' "<missing>"
}

source_version=$(show_json_value "$source_sha" app-expo/package.json 'version')
target_version=$(show_json_value "$target_sha" app-expo/package.json 'version')

echo "OTA監査入力"
printf 'ソース: %s (%s)\n' "$source_ref" "$source_sha"
printf '対象: %s (%s)\n' "$target_ref" "$target_sha"
printf 'merge-base: %s\n' "$merge_base"
printf '対象のみ/ソースのみのコミット数: %s\n' "$counts"
printf 'ソースのapp version: %s\n' "$source_version"
printf '対象のapp version: %s\n' "$target_version"

echo
echo "履歴関係"
# targetがsourceの祖先なら通常mergeはfast-forwardになり、source側のversionで
# targetのruntimeVersionまで置換される。この場合は--no-ffとversion復元の検討が必要。
if git merge-base --is-ancestor "$target_sha" "$source_sha"; then
  echo "対象はソースの祖先です。通常のmergeはfast-forwardして対象versionを置き換える可能性があります。"
elif git merge-base --is-ancestor "$source_sha" "$target_sha"; then
  echo "ソースは既に対象の祖先です。"
else
  echo "ソースと対象は分岐しています。"
fi

echo
echo "変更されたネイティブ影響候補パス（対象ツリー → ソースツリー）"
# ここでは「怪しい入力を漏らさない」方向へ広めに抽出する。
# eas.jsonやroot lockfileは必ずしもネイティブ差分を意味しないが、無視すると
# build image、config plugin、解決versionの変化を見落とすため候補に含める。
native_path_pattern='(^|/)(ios|android)(/|$)|(^|/)(app\.config\.[^/]+|app\.json|eas\.json|package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Podfile[^/]*|.*\.podspec|gradle\.properties|settings\.gradle[^/]*|build\.gradle[^/]*|google-services\.json|GoogleService-Info\.plist)$|(^|/)(patches|plugins)(/|$)'
native_paths=$(
  git diff --name-status "$target_sha" "$source_sha" |
    awk -F '\t' '{ print $0 }' |
    { rg "$native_path_pattern" || true; }
)
if [[ -n "$native_paths" ]]; then
  printf '%s\n' "$native_paths"
else
  echo "<パス規則では検出なし>"
fi

echo
echo "アプリの直接dependency変更"
# version文字列の差だけではなく、package名と指定versionの組を比較する。
# 同じpackage名でもversion指定が変われば、追加側・削除側の両方に表示される。
# devDependenciesは別途native-sensitive diffとlockfile履歴で確認する。
# JSON処理には、このリポジトリの開発環境で利用可能なpython3を使う。
if git cat-file -e "${source_sha}:app-expo/package.json" 2>/dev/null &&
  git cat-file -e "${target_sha}:app-expo/package.json" 2>/dev/null; then
  echo "追加または変更:"
  comm -13 \
    <(git show "${target_sha}:app-expo/package.json" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(*[f"{key}\t{value}" for key, value in sorted(data.get("dependencies", {}).items())], sep="\n")') \
    <(git show "${source_sha}:app-expo/package.json" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(*[f"{key}\t{value}" for key, value in sorted(data.get("dependencies", {}).items())], sep="\n")') ||
    true
  echo "削除または変更:"
  comm -23 \
    <(git show "${target_sha}:app-expo/package.json" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(*[f"{key}\t{value}" for key, value in sorted(data.get("dependencies", {}).items())], sep="\n")') \
    <(git show "${source_sha}:app-expo/package.json" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(*[f"{key}\t{value}" for key, value in sorted(data.get("dependencies", {}).items())], sep="\n")') ||
    true
else
  echo "<いずれかにapp-expo/package.jsonがありません>"
fi

echo
echo "ネイティブ影響候補の差分要約"
# 出力をstatへ限定し、google-services.jsonなどの内容やsecretを表示しない。
git diff --stat "$target_sha" "$source_sha" -- \
  app-expo/package.json \
  app-expo/app.json \
  'app-expo/app.config.*' \
  app-expo/eas.json \
  app-expo/ios \
  app-expo/android \
  app-expo/plugins \
  app-expo/google-services.json \
  pnpm-lock.yaml \
  patches ||
  true

echo
echo "アプリソースの新規・変更import（ネイティブpackageか手動確認すること）"
# package.jsonに追加がなくても、既存またはtransitive dependencyのネイティブmoduleを
# 新しくimportする場合がある。その見落としを減らす補助一覧である。
# 最大200行に制限し、巨大差分で監査結果が埋もれることを避ける。
git diff --unified=0 "$target_sha" "$source_sha" -- \
  'app-expo/**/*.ts' \
  'app-expo/**/*.tsx' \
  'app-expo/**/*.js' \
  'app-expo/**/*.jsx' |
  { rg '^\+[^+].*(from[[:space:]]+["'\'']|require\(["'\''])' || true; } |
  sed -n '1,200p'

echo
echo "merge-base以降にネイティブ影響候補を変更したコミット"
# 最終ツリー差分だけでなく履歴も見る。途中でnative dependencyを追加・削除した結果、
# lockfileや生成物に意図しない残骸があるケースを調べる手掛かりになる。
git log --oneline --no-merges "${merge_base}..${source_sha}" -- \
  app-expo/package.json \
  app-expo/app.json \
  'app-expo/app.config.*' \
  app-expo/eas.json \
  app-expo/ios \
  app-expo/android \
  app-expo/plugins \
  app-expo/google-services.json \
  pnpm-lock.yaml \
  patches |
  sed -n '1,200p'

echo
echo "このレポートだけではOTA-safe/unsafeを分類しません。"
echo "マージ予定ツリーを、iOS・Androidそれぞれの実配布済みネイティブbuildと比較してください。"
