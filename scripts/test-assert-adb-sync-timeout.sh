#!/bin/bash
# =============================================================================
# `assert-adb-sync-timeout.mjs` の自己テスト
#
# ## なぜ要るか
#
# #1579 の事故は «adb wait-for-device に上限が無い» 1 行だったが、同じ瞬間に
# **adb の呼び出し 6 箇所すべてが上限なし**だった。つまり «1 箇所直して終わり» にしやすい形で、
# ガードが取りこぼすことそのものが再発である。だから取りこぼしを固定する。
#
# ⚠️ 逆向き（誤検知）も縛る。**ガードの説明文に `execFileSync("adb"` と書けること**が要る。
#    書けないと «なぜこのガードが要るのか» を該当ファイルへ残せず、いずれガードごと外される。
#
# 依存は node だけ。一時ディレクトリの中で完結する。
#
# 使い方: bash scripts/test-assert-adb-sync-timeout.sh
# =============================================================================
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/assert-adb-sync-timeout.mjs"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0

check() { # check <説明> <期待(ok|ng)> <実際の終了コード>
  local label="$1" want="$2" code="$3"
  local got="ok"; [ "$code" -ne 0 ] && got="ng"
  if [ "$got" = "$want" ]; then
    echo "  ✅ $label"
    pass=$((pass + 1))
  else
    echo "  ❌ $label（期待 $want / 実際 $got）"
    fail=$((fail + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/e2e-mobile/utils"

run_on() { # run_on <相対パス> <本文>
  local name="$1" body="$2"
  printf '%s\n' "$body" > "$TMP/$name"
  ( cd "$TMP" && node "$GUARD" "$name" >/dev/null 2>&1 )
}

echo "A. 違反として検出できること（ng が正しい）"

run_on direct.ts 'const out = execFileSync("adb", ["-s", id, "shell", "echo"]);'
check 'execFileSync("adb", …) を直に呼ぶ' ng $?

run_on direct_sq.ts "const out = execSync('adb devices');"
check "execSync('adb …')（単一引用符）" ng $?

run_on direct_spawn.ts 'const out = spawnSync("adb", ["devices"]);'
check 'spawnSync("adb", …)' ng $?

run_on direct_tpl.ts 'const out = execFileSync(`adb`, ["devices"]);'
check 'execFileSync(`adb`, …)（テンプレートリテラル）' ng $?

run_on wait_no_budget.ts 'adbSync(["wait-for-device"]);'
check 'adbSync(["wait-for-device"]) に timeoutMs が無い（#1579 の真因そのもの）' ng $?

run_on wait_multiline.ts "$(printf 'adbSync([\n\t"wait-for-any-device",\n]);\n')"
check "複数行に分かれた wait-for-any-device（括弧を閉じるまで読むこと）" ng $?

run_on logcat_follow.ts 'const log = adbSync(["logcat"]);'
check "adbSync([\"logcat\"])（追従なので返ってこない）" ng $?

run_on e2e-mobile/utils/adb.ts "$(printf 'export function adbSync(args) {\n\treturn execFileSync("adb", ["-s", device.id, ...args], { encoding: "utf8" });\n}\n')"
check "唯一の入口が timeout を渡していない" ng $?

run_on bare_wait.sh "$(printf '#!/bin/bash\nset -euo pipefail\nadb wait-for-device\n')"
check "シェルの素の adb wait-for-device" ng $?

run_on bare_wait_tolerant.sh "$(printf '#!/bin/bash\nadb wait-for-any-device || true\n')"
check "シェルの adb wait-for-any-device（|| true でも上限は無い）" ng $?

echo ""
echo "B. 違反ではないものを違反と読まないこと（ok が正しい）"

run_on commented.ts "$(printf '// #1579 ここで execFileSync("adb", …) を直に呼ばないこと\nconst v = adbSync(["shell", "echo", "ok"]);\n')"
check '行コメントの中の execFileSync("adb"（説明文を書けること）' ok $?

run_on block_comment.ts "$(printf '/*\n * 旧実装: execFileSync("adb", ["-s", id, "wait-for-device"])\n */\nconst v = adbSync(["shell", "echo"]);\n')"
check "ブロックコメントの中の同じ形" ok $?

run_on wait_with_budget.ts 'adbSync(["wait-for-device"], { timeoutMs: 5_000 });'
check "wait-for-device に timeoutMs を明示している（修正後の形）" ok $?

run_on logcat_dump.ts 'const log = adbSync(["logcat", "-d"]);'
check 'adbSync(["logcat", "-d"])（溜まっているぶんを吐いて終わる）' ok $?

run_on plain.ts 'const v = adbSync(["shell", "am", "get-config"]);'
check "ふつうの adbSync（上限は入口が持っている）" ok $?

run_on timed_wait.sh "$(printf '#!/bin/bash\nset -euo pipefail\ntimeout 60 adb wait-for-device\n')"
check "timeout 60 adb wait-for-device（修正後の形）" ok $?

run_on commented_wait.sh "$(printf '#!/bin/bash\n# adb wait-for-device には上限が無い\ntimeout "$S" adb wait-for-device\n')"
check "シェルのコメントの中の adb wait-for-device（説明文を書けること）" ok $?

run_on e2e-mobile/utils/adb.ts "$(printf 'export function adbSync(args, options = {}) {\n\treturn execFileSync("adb", ["-s", device.id, ...args], {\n\t\tencoding: "utf8",\n\t\ttimeout: options.timeoutMs ?? ADB_TIMEOUT_MS,\n\t});\n}\n')"
check "唯一の入口が timeout を渡している（adb を直に呼ぶのはここだけ許す）" ok $?

echo ""
echo "C. このリポジトリが現に緑であること"
( cd "$REPO_ROOT" && node "$GUARD" >/dev/null )
check "e2e-mobile 全体に上限なしの adb 呼び出しが無い" ok $?

echo ""
echo "pass $pass / fail $fail"
[ "$fail" -eq 0 ]
