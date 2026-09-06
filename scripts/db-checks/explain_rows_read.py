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
    total = 0
    detail = []
    for line in plan:
        s = line.strip()
        if not pattern.search(s):
            continue
        m = _ACTUAL_RE.search(s)
        if not m:
            continue
        n = int(m.group(1)) * int(m.group(2))
        total += n
        detail.append((s[:110], n))
    return total, detail


# `restaurants` 本体と、その位置索引。
# ⚠️ `restaurant_opening_hours` など «restaurant» で始まる別表に当たらないよう、
#    末尾の \b まで含めて完全な語で縛る。
_RESTAURANTS_RE = re.compile(r"\bon (restaurants|idx_restaurants_location)\b")


def restaurants_rows_read(plan):
    """実行計画から «restaurants を読んだ延べ行数» を拾う。"""
    return rows_read(plan, _RESTAURANTS_RE)


def table_rows_read(plan, table):
    """実行計画から «`table` を読んだ延べ行数» を拾う。

    索引経由（`Index Scan using idx_… on <table>`）でも表名で当たるように、
    `on <table>` の形を見る。別表の接頭辞に巻き込まれないよう前後を \b で閉じる。
    """
    return rows_read(plan, re.compile(rf"\bon {re.escape(table)}\b"))
