#!/usr/bin/env bash
# =============================================================================
# #1815 «解けなかった解き直し» が «解けていた結果» を殺す形を復活させない
# =============================================================================
#
# 2026-09-05、カバレッジが cov13 (≥5 セル 987) → cov14 (961) と **26 セル減った**。
# 収集も配信も止めていないのに減った理由は、投稿ごとの resolve 結果を
# `ORDER BY resolved_at DESC` だけで選んでいたこと。低収率の解き直し
# (`sns-2026-09-04-ccwat`) が後から書き込まれ、**カテゴリ無し・matched でない行が
# «最新» として勝ってしまい 4,802 投稿がカテゴリを、1,272 投稿が matched を失った**。
#
# resolve に «取り消し» は無い。カテゴリ無し／matched でない行は «決められなかった»
# であって «前の判断を否定した» ではない。
#
# このテストは個別の値ではなく **パターン**を固定する:
#   1. 共通の判定が «カテゴリ有り → matched → 最新» の順で選んでいること
#   2. どのスクリプトにも «resolved_at だけで選ぶ» QUALIFY が書かれていないこと
#      （＝共通定数を写経して戻す経路を塞ぐ）
#
# 使い方:
#   bash scripts/20260808T0000_restaurant/tests/test_latest_resolved_qualify.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { echo "❌ $*" >&2; exit 1; }

# --- 1. 共通判定の並び順 ---------------------------------------------------
QUALIFY="$(python3 -c "import sys; sys.path.insert(0, '$DIR'); import common_sns; print(common_sns.LATEST_RESOLVED_QUALIFY)")"

echo "$QUALIFY" | grep -q "dish_category_id IS NOT NULL" \
  || fail "カテゴリの有無が並び順に入っていない: $QUALIFY"
echo "$QUALIFY" | grep -q "status = 'matched'" \
  || fail "matched かどうかが並び順に入っていない: $QUALIFY"
echo "$QUALIFY" | grep -q "resolved_at DESC" \
  || fail "最後の tie-break が resolved_at になっていない: $QUALIFY"

# 順序そのものを見る。カテゴリ → matched → resolved_at の位置関係が崩れたら落とす。
python3 - "$QUALIFY" <<'PY'
import sys
q = sys.argv[1]
i_cat = q.index("dish_category_id IS NOT NULL")
i_matched = q.index("status = 'matched'")
i_time = q.index("resolved_at DESC")
assert i_cat < i_matched < i_time, (
    f"並び順が «カテゴリ有り → matched → 最新» になっていない: {q}")
PY

# --- 2. 写経の禁止 ---------------------------------------------------------
# 共通定数を使わず «resolved_at だけ» で選ぶ QUALIFY が復活していないか。
if grep -rn "QUALIFY ROW_NUMBER() OVER (PARTITION BY provider, post_id ORDER BY resolved_at" \
     "$DIR" --include=*.py >/tmp/qualify_copies.txt 2>/dev/null; then
  cat /tmp/qualify_copies.txt >&2
  fail "resolved_at だけで選ぶ QUALIFY が書かれている。common_sns.LATEST_RESOLVED_QUALIFY を使うこと"
fi

# --- 3. 使う側が共通定数を通していること -----------------------------------
for f in 7_1_build_coverage.py 9_1_build_sns_dish_media_catalog.py; do
  grep -q "LATEST_RESOLVED_QUALIFY" "$DIR/$f" \
    || fail "$f が共通の resolve 選択判定を使っていない"
done

echo "✅ resolve 結果の選び方は «カテゴリ有り → matched → 最新» で固定されている"
