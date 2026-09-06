"""#1666 EXPLAIN の実行計画から «その表を延べ何行読んだか» を数える（依存ゼロ）。

## なぜ独立したファイルなのか

数え方は 3 本のスクリプト（`measure_order_by_posts` / `explain_dish_media_search` /
`explain_opening_status`）が共有する **判定そのもの**である。写経すると、片方だけ
直したときに «同じプランを見て違う結論を出す» 状態になる（CLAUDE.md「本番のロジックを
テストへ写経しない」と同じ理由）。

加えて、呼び出し元は 3 本とも `psycopg2` を import するため **CI では import できない**。
純関数だけをここへ出しておけば、`test_explain_rows_read.py` が依存なしで縛れる。

## 数え方 —— **rows ではなく loops × rows**

LATERAL や Nested Loop の内側は「loops 回まわって毎回 0〜N 行」なので、`rows=` だけを
見ると **1 桁小さく見える**。半径に比例して重くなるかを見るのが目的なので、延べで数える。

## ⚠️ この数え方には **下限がある**。0 を «読んでいない» と読んではいけない

`rows=` は **1 loop あたりの平均で、整数に丸められて**表示される。
1 loop あたり 0.5 行未満なら `rows=0` になり、掛け算の結果も 0 になる。

2026-09-06 に dev で実測した実物（[run 34036910547](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34036910547)）:

    -> Index Scan using idx_restaurant_hours_exceptions_date on restaurant_hours_exceptions rhe
       (cost=0.15..1.27 rows=1 width=69) (actual time=0.001..0.001 rows=0 loops=1000)
       Buffers: shared hit=2000

**2,000 回バッファに触っているのに «0 行» である。**

営業時間テーブルは «候補 1,000 件のうち十数件しか当たらない» ので、まさにこの範囲に落ちる
（東京駅の近い順 1,000 件のうち、今日の曜日の行を持つ店は 11 店 / run 34036860847）。
つまり `restaurant_opening_hours から延べ 0 行 ✅` は **«軽い» の根拠にならない**。

- **捕まえられるもの**: 全件走査へ倒れる致命的な劣化（rows が桁で大きくなる）
- **捕まえられないもの**: 0 行と «loops × 0.49 行» の区別（loops=1000 なら最大 499 行）

そこで `rows_read` は «丸めの下限に当たったか» も返す。呼び出し側はそれを
`✅` ではなく **「測定下限未満」** として出すこと。**0 を根拠に «閉じている» と書かない。**
"""

from __future__ import annotations

import re

# `(actual time=0.005..0.006 rows=2 loops=1000)` から rows と loops を取る。
# ⚠️ `EXPLAIN (ANALYZE)` を付けずに回すとこの括弧が出ず、**0 行と数えてしまう**。
#    呼び出し側は必ず ANALYZE 付きで回すこと。
_ACTUAL_RE = re.compile(r"actual time=[\d.]+\.\.[\d.]+ rows=(\d+) loops=(\d+)")


def rows_read(plan, pattern):
    """`pattern`（コンパイル済み正規表現）に当たる Scan 行の «loops × rows» を合計する。

    戻り値は `(合計行数, [(計画の行, その行数), ...])`。
    """
    total, detail, _ = rows_read_with_floor(plan, pattern)
    return total, detail


def rows_read_with_floor(plan, pattern):
    """`rows_read` に «丸めの下限に当たったか» を足して返す。

    戻り値は `(合計行数, [(計画の行, その行数), ...], 下限に当たった loops の最大値)`。
    3 つ目が 0 より大きいとき、合計行数は **下限であって実測ではない**。
    その節は 1 loop あたり 0.5 行未満で、延べ最大 `loops × 0.5` 行を読みうる。
    """
    total = 0
    detail = []
    floor_loops = 0
    for line in plan:
        s = line.strip()
        if not pattern.search(s):
            continue
        m = _ACTUAL_RE.search(s)
        if not m:
            continue
        rows = int(m.group(1))
        loops = int(m.group(2))
        total += rows * loops
        detail.append((s[:110], rows * loops))
        # rows=0 なのに何度も回っている節は «読んでいない» とは限らない。
        # 1 loop あたり 0.5 行未満が丸められているだけかもしれない。
        if rows == 0 and loops > 1:
            floor_loops = max(floor_loops, loops)
    return total, detail, floor_loops


# `restaurants` 本体と、その位置索引。
# ⚠️ `restaurant_opening_hours` など «restaurant» で始まる別表に当たらないよう、
#    末尾の \b まで含めて完全な語で縛る。
_RESTAURANTS_RE = re.compile(r"\bon (restaurants|idx_restaurants_location)\b")


def restaurants_rows_read(plan):
    """実行計画から «restaurants を読んだ延べ行数» を拾う。"""
    return rows_read(plan, _RESTAURANTS_RE)


def _table_pattern(table):
    """索引経由（`Index Scan using idx_… on <table>`）でも表名で当たる形。

    別表の接頭辞（`restaurant_opening_hours` と `restaurants`）に巻き込まれないよう
    前後を \b で閉じる。
    """
    return re.compile(rf"\bon {re.escape(table)}\b")


def table_rows_read(plan, table):
    """実行計画から «`table` を読んだ延べ行数» を拾う。"""
    return rows_read(plan, _table_pattern(table))


def table_rows_read_with_floor(plan, table):
    """`table_rows_read` に «丸めの下限に当たったか» を足して返す。

    ⚠️ 3 つ目が 0 より大きいとき、**合計行数を «軽い» の根拠にしてはいけない**
    （このファイル冒頭の注記）。
    """
    return rows_read_with_floor(plan, _table_pattern(table))
