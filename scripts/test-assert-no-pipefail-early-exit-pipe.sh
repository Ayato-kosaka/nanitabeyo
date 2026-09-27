#!/bin/bash
# =============================================================================
# `assert-no-pipefail-early-exit-pipe.mjs` の自己テスト
#
# ## なぜ要るか
#
# #2075 で «pipefail + `| grep -q`» を 2 本のファイルで直したが、**その 2 本の中に
# `| head -1` という同じ形が残っていた**。つまり «1 箇所直して終わりにした» の実例が
# 修正そのものの中にあった。ガードを 1 本に集約するのはそのためで、
# **ガードが «取りこぼす» ことこそが再発なので、取りこぼしを固定する。**
#
# ⚠️ 実際に 2 回取りこぼした（2026-09-27 に実測）。両方ここで縛る。
#   A. `-qw` / `-qE` / `-Eq` — q が **フラグの塊の末尾に無い**形
#   B. `v="$(… | head -n 1)"` — 二重引用符の中の `$( … )` を **文字列として潰していた**
#
# ⚠️ 逆向き（誤検知）も縛る。`echo "… | head"` のような **説明文**を違反と読むと、
#    書けない文章ができてガードごと外される。
#
# 依存は node だけ。一時ディレクトリの中で完結する。
#
# 使い方: bash scripts/test-assert-no-pipefail-early-exit-pipe.sh
# =============================================================================
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/assert-no-pipefail-early-exit-pipe.mjs"
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

# fixture <名前> <本文>  → 検査して終了コードを返す
run_on() { # run_on <名前> <本文>
  local name="$1" body="$2"
  printf '%s\n' "$body" > "$TMP/$name.sh"
  ( cd "$TMP" && node "$GUARD" "$name.sh" >/dev/null 2>&1 )
}

echo "A. 違反として検出できること（ng が正しい）"

run_on has_grep_q "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nif cat /etc/hosts | grep -q localhost; then :; fi\n')"
check "| grep -q" ng $?

run_on has_grep_q_negated "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nif ! cat /etc/hosts | grep -q localhost; then :; fi\n')"
check "! … | grep -q（否定形。«在っても無い» と言う方）" ng $?

run_on has_grep_qE "$(printf '#!/usr/bin/env bash\nset -euo pipefail\ncat /etc/hosts | grep -qE "local"\n')"
check "| grep -qE（q がフラグの末尾に無い）" ng $?

run_on has_grep_qw "$(printf '#!/usr/bin/env bash\nset -euo pipefail\ncat /etc/hosts | grep -qw local\n')"
check "| grep -qw" ng $?

run_on has_grep_Eq "$(printf '#!/usr/bin/env bash\nset -euo pipefail\ncat /etc/hosts | grep -Eq "local"\n')"
check "| grep -Eq" ng $?

run_on has_grep_m "$(printf '#!/usr/bin/env bash\nset -euo pipefail\ncat /etc/hosts | grep -m 1 local\n')"
check "| grep -m 1" ng $?

run_on has_head "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nv=$(cat /etc/hosts | head -1)\n')"
check "| head -1" ng $?

run_on has_head_in_dq_subst "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nv="$(cat /etc/hosts | head -n 1)"\n')"
check '二重引用符の中の $( … | head -n 1 )（コードとして読むこと）' ng $?

run_on has_head_nested_subst "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nv="$(echo "$(cat /etc/hosts)" | head -n 1)"\n')"
check '$( … ) の入れ子の中の | head（括弧の深さを数えること）' ng $?

run_on set_o_pipefail_only "$(printf '#!/usr/bin/env bash\nset -o pipefail\ncat /etc/hosts | grep -q localhost\n')"
check "set -o pipefail（単独指定）でも検出する" ng $?

run_on set_Eeuo "$(printf '#!/usr/bin/env bash\nset -Eeuo pipefail\ncat /etc/hosts | grep -q localhost\n')"
check "set -Eeuo pipefail でも検出する" ng $?

echo ""
echo "B. 違反ではないものを違反と読まないこと（ok が正しい）"

run_on no_pipefail "$(printf '#!/usr/bin/env bash\nset -eu\nif cat /etc/hosts | grep -q localhost; then :; fi\n')"
check "pipefail を立てていないファイル（この欠陥は起きない）" ok $?

run_on echoed_text "$(printf '#!/usr/bin/env bash\nset -euo pipefail\necho "  comm -23 a b | head"\n')"
check '文字列の中の説明文（echo "… | head"）' ok $?

run_on commented "$(printf '#!/usr/bin/env bash\nset -euo pipefail\n# ここでは cat x | grep -q y にしないこと\n')"
check "コメント行の中の注意書き" ok $?

run_on fixed_form "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nbody="$(cat /etc/hosts)"\ngrep -q localhost <<< "$body"\nv="$(head -1 <<< "$body")"\n')"
check "修正後の形（先に変数へ受け切って <<< で渡す）" ok $?

run_on tail_is_fine "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nv=$(cat /etc/hosts | tail -1)\n')"
check "| tail（最後まで読むので SIGPIPE にならない）" ok $?

run_on grep_c_is_fine "$(printf '#!/usr/bin/env bash\nset -euo pipefail\nn=$(cat /etc/hosts | grep -c localhost || true)\n')"
check "| grep -c（最後まで読む）" ok $?

echo ""
echo "C. このリポジトリが現に緑であること"
( cd "$REPO_ROOT" && node "$GUARD" >/dev/null )
check "リポジトリ全体（git ls-files '*.sh'）に違反が無い" ok $?

echo ""
echo "pass $pass / fail $fail"
[ "$fail" -eq 0 ]
