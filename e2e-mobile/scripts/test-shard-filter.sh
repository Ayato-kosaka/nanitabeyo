#!/usr/bin/env bash
# 🧪 シャード分割（#2001）の «割り当て» と «冪等性» を jest 実機で突き合わせる自己テスト（#1579）
#
# ## なぜ必要か
# iOS の夜間は jest の `--shard=N/M` で 2 分割していたが、Detox の `--retries 1` が呼び直す
# 2 巡目にも `--shard` がそのまま付くため、**赤の約半分しか再実行されていなかった**
# （jest の --shard は «渡されたリストを M 等分» する実装なので、失敗分だけに縮んだリストが
# もう一度割られる）。2026-10-07 の夜間が対照になっている:
#   Android（shard なし） 初回 6 failed → retry 6 件（全部）
#   iOS [1/2]（shard あり） 初回 5 failed → retry 3 件（約半分）
#
# 直し方は «件数で割る» をやめて **ファイルの同一性で選ぶ**（DETOX_SHARD_FILES）。
# ここで固定するのは個別のファイル名ではなく **その性質** である:
#   「シャード指定は、部分集合へ再適用しても同じ集合を残す（= retry で再分割されない）」
#
# ⚠️ 期待値を写経しないこと。割り当ては jest の `--shard` が正なので、**毎回 jest に作らせて**
#    突き合わせる。jest を上げて割り方が変わったらここが落ちる（それが知りたい）。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
readonly JEST=(node node_modules/jest/bin/jest.js)

# jest の出力（絶対パス）を e2e-mobile 相対の並びへ正規化する
list() { "${JEST[@]}" --listTests "$@" 2>/dev/null | sed 's#.*/e2e-mobile/##' | sort; }
# ⚠️ #2075 `set -euo pipefail` の下でパイプの下流に早期終了（head など）を置かないこと。
# 一度変数へ受けてから `<<<` で渡す。count もパイプではなく here-string で数える。
join() { paste -s -d, - <<< "$1"; }
count() { grep -c . <<< "$1" || true; }

fail() {
	echo "❌ $1"
	exit 1
}

all="$(list)"
shard1="$(list --shard=1/2)"
shard2="$(list --shard=2/2)"
[ -n "$all" ] || fail "spec が 1 件も見つかりません"

# ── 1. シャードは重複せず、合わせると全件になる ──────────────────────────────
if [ -n "$(comm -12 <(printf '%s\n' "$shard1") <(printf '%s\n' "$shard2"))" ]; then
	fail "shard 1/2 と 2/2 に同じ spec が入っています"
fi
if [ "$(printf '%s\n%s\n' "$shard1" "$shard2" | sort)" != "$all" ]; then
	fail "shard 1/2 + 2/2 が全件と一致しません"
fi

# ── 2. DETOX_SHARD_FILES は jest の --shard と同じ集合を選ぶ ─────────────────
# （割り当てが変わると、シャードごとの所要時間の見積り = iOS の timeout-minutes が崩れる）
for n in 1 2; do
	expected="$(list --shard="$n/2")"
	actual="$(DETOX_SHARD_FILES="$(join "$expected")" list)"
	[ "$actual" = "$expected" ] || fail "DETOX_SHARD_FILES が shard $n/2 と違う集合を選びました"
done

# ── 3. ⭐ 本題: 部分集合へ再適用しても «再分割されない»（retry で赤が全部走る） ──
# Detox の retry は «失敗したファイルを位置引数で並べて jest を呼び直す» ので、ここでも同じ形で渡す。
subset="$(head -5 <<< "$shard1")"
[ "$(count "$subset")" -eq 5 ] || fail "部分集合を 5 件作れません（spec が少なすぎます）"

# shellcheck disable=SC2046 # 位置引数として 1 ファイルずつ渡したい
retried="$(DETOX_SHARD_FILES="$(join "$shard1")" list $(printf '%s ' $subset))"
[ "$retried" = "$subset" ] || fail "retry 相当の呼び出しで集合が変わりました（期待 5 件 / 実際 $(count "$retried") 件）。シャード指定が冪等ではありません"

# 旧実装（`--shard` を retry へ付け直す形）では、ここが 5 件より少なくなる。
# 「この形に戻していない」ことまで固定したいので、旧実装が実際に欠けることも確かめる。
# shellcheck disable=SC2046
old="$(list --shard=1/2 $(printf '%s ' $subset))"
old_count="$(count "$old")"
if [ "$old_count" -ge 5 ]; then
	echo "⚠️ jest の --shard が部分集合でも全件を返すようになっています（$old_count 件）。"
	echo "   この自己テストの前提（--shard は冪等でない）が変わったので、本文の説明を見直してください。"
fi

# ── 4. 未設定なら従来どおり全件 ──────────────────────────────────────────────
[ "$(DETOX_SHARD_FILES="" list)" = "$all" ] || fail "DETOX_SHARD_FILES が空のときに絞り込みが効いています"

echo "✅ シャード指定は jest の --shard と同じ集合を選び、部分集合へ再適用しても再分割されません"
echo "   全 $(count "$all") 件 / shard 1/2 $(count "$shard1") 件 / shard 2/2 $(count "$shard2") 件 / 旧 --shard の retry 相当 ${old_count} 件（< 5 なら欠けている）"
