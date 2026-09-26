#!/bin/bash
# =============================================================================
# `assert-migration-filename-order.sh` の自己テスト
#
# ## なぜ要るか
#
# このガードは「ファイル名昇順 = 適用順」を守る最後の砦なのに、**テストが無かった**。
# 2026-09-24 に実際に擦り抜けた（#2012 / #1933）。抜けたのはスクリプトの論理ではなく
# **workflow の «何と比べるか»** で、`github.event.pull_request.base.sha`
# （PR イベント時点の main のスナップショット）と比べていたため、PR が開いている間に
# main が migration を得ても再検査されず、緑のまま古くなった。
#
# ⚠️ だからここでは 2 つを別々に縛る。
#   A. スクリプトの論理（割り込む名前を落とすか）
#   B. **workflow の配線**（ブランチの «いまの先頭» と比べているか）← 実際に抜けたのはこっち
#
# 依存ゼロ。一時的な git リポジトリを作って回すので、このリポジトリの状態に依存しない。
#
# 使い方: bash scripts/test-assert-migration-filename-order.sh
# =============================================================================
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/assert-migration-filename-order.sh"
WORKFLOW="$(cd "$(dirname "$0")/.." && pwd)/.github/workflows/migration-order-check.yml"
MIGRATION_DIR="infra/supabase/migrations"
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

# --- A. スクリプトの論理 -------------------------------------------------------
sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT
(
  cd "$sandbox"
  git init -q .
  git config user.email t@example.com
  git config user.name t
  mkdir -p "$MIGRATION_DIR"
  : > "$MIGRATION_DIR/20260101T0000_first.sql"
  : > "$MIGRATION_DIR/20260201T0000_second.sql"
  git add -A && git commit -qm base
  git branch base-snapshot
  # main 相当が後続の migration を得る（= #2043 が入った状況）
  : > "$MIGRATION_DIR/20260301T0000_third.sql"
  git add -A && git commit -qm "main gains a migration"
  git branch main-tip
) >/dev/null 2>&1

echo "A. スクリプトの論理"

# A-1 最後尾より後ろなら通る
(
  cd "$sandbox" && git checkout -q -B feat main-tip
  : > "$MIGRATION_DIR/20260401T0000_new.sql"
  git add -A && git commit -qm feat
  bash "$GUARD" main-tip
) >/dev/null 2>&1
check "最後尾より後ろの名前は通る" ok $?

# A-2 適用列の途中へ割り込む名前は落ちる ← #2012 で起きた形
(
  cd "$sandbox" && git checkout -q -B interleaved main-tip
  : > "$MIGRATION_DIR/20260215T0000_interleaved.sql"
  git add -A && git commit -qm interleaved
  bash "$GUARD" main-tip
) >/dev/null 2>&1
check "適用列の途中へ割り込む名前は落ちる" ng $?

# A-3 ⚠️ **古いスナップショットと比べると、同じものが通ってしまう**
#     ここが «緑のまま古くなる» の再現である。スクリプトは渡されたものと比べるだけなので、
#     渡す側（workflow）が間違っていれば擦り抜ける。
(
  cd "$sandbox" && git checkout -q interleaved
  bash "$GUARD" base-snapshot
) >/dev/null 2>&1
check "同じ名前がスナップショット相手だと通ってしまう（配線の危うさの再現）" ok $?

# A-4 ファイル名の形式
(
  cd "$sandbox" && git checkout -q -B badname main-tip
  : > "$MIGRATION_DIR/add_something.sql"
  git add -A && git commit -qm badname
  bash "$GUARD" main-tip
) >/dev/null 2>&1
check "YYYYMMDDTHHMM_ の形でない名前は落ちる" ng $?

# A-5 migration を触らない差分は通る
(
  cd "$sandbox" && git checkout -q -B nomigration main-tip
  echo x > readme.txt
  git add -A && git commit -qm nomigration
  bash "$GUARD" main-tip
) >/dev/null 2>&1
check "migration を追加していない差分は通る" ok $?

# --- B. workflow の配線（実際に抜けたのはここ） --------------------------------
echo "B. workflow の配線"

# ⚠️ **コメント行を落としてから見る。** 冒頭の注記に `base.sha` という語が出てくるので、
#    ファイル全体を grep すると «使っている» と誤検知する（最初そう書いて落ちた）。
workflow_code() { grep -v '^[[:space:]]*#' "$WORKFLOW"; }

# ⚠️ **`… | grep -q` にしないこと（#2075）。** このファイルは `set -o pipefail` で走る。
#    `grep -q` は最初の一致で即座に終わるので上流が SIGPIPE で殺され、pipefail が
#    その **141 をパイプライン全体の終了コードにする** — つまり «一致しているのに ng» になる。
#    小さいファイルでは普通は通るので、**CI でだけ稀に赤くなる**（実測: 2026-09-26 の main
#    https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36206053417 で
#    `test-assert-drop-safe-for-deployed-code.sh` の 1 行だけが ng。同じ commit をローカルで
#    回すと全部緑だった）。
#
# ⚠️ **否定形（`! … | grep -q`）はもっと悪い。** 141 も «非ゼロ» なので `!` が true にしてしまい、
#    **パターンが在っても «無い» と言い切る**。落ちない検査になる。
WORKFLOW_CODE="$(workflow_code)"

grep -q 'pull_request\.base\.ref' <<< "$WORKFLOW_CODE"
check "base ブランチ名（base.ref）を使っている" ok $?

! grep -q 'pull_request\.base\.sha' <<< "$WORKFLOW_CODE"
check "base.sha（イベント時点のスナップショット）を使っていない" ok $?

grep -q 'assert-migration-filename-order\.sh FETCH_HEAD' <<< "$WORKFLOW_CODE"
check "取得した «いまの先頭»（FETCH_HEAD）を渡している" ok $?

# ⚠️ #2075 この形へ戻さないための自己検査。コメント行は除いて数える
PIPED_GREP_Q=$(grep -vE '^[[:space:]]*#' "$0" | grep -cE '\|[[:space:]]*grep[[:space:]]+-q' || true)
[ "$PIPED_GREP_Q" -eq 0 ]
check "パイプの下流で grep -q を使っていない（pipefail で 141 になる）" ok $?

echo ""
echo "pass $pass / fail $fail"
[ "$fail" -eq 0 ]
