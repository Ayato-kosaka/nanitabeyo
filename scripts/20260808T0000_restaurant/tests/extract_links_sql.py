#!/usr/bin/env python3
"""9_1 の restaurant_links の DELETE / INSERT をソースから抜き出す。

#843 テストで SQL を写経すると本物と静かにずれる（2026-08-29 に実際に起きた）。
`--which delete|insert` で 1 本を標準出力へ出す。psycopg2 の `%%` は psql 用に `%` へ戻す。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"

PATTERNS = {
    "delete": r'"""\s*(DELETE FROM restaurant_links.*?)"""',
    "insert": r'"""\s*(INSERT INTO restaurant_links.*?)"""',
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--which", choices=sorted(PATTERNS), required=True)
    args = parser.parse_args()

    src = SOURCE.read_text(encoding="utf-8")
    found = re.findall(PATTERNS[args.which], src, re.S)
    if len(found) != 1:
        sys.exit(f"{args.which} の SQL を一意に取れませんでした（{len(found)}件）")
    sql = found[0]

    # #1881 バッチの範囲条件（`%(lo)s` / `%(hi)s`）を落とす。
    #
    # 本番では staging を google_place_id 順に切って同じ文を流すが、psql は
    # psycopg2 の名前付きプレースホルダを解釈できない（`syntax error at or near "%"`）。
    # このテストが見たいのは **リンクの取捨選択のロジック**なので、範囲だけ外して流す。
    #
    # ⚠️ **«範囲条件が付いていること» 自体は、ここではなく
    #    `test_9_1_batched_statements.py` が縛る。** ここで黙って落とすだけだと、
    #    付け忘れてもテストが緑のままになる。
    sql = re.sub(r"\n\s*AND s\.google_place_id (>|<=) %\(\w+\)s", "", sql)

    # psycopg2 のリテラル %% は psql では % 一つ
    sys.stdout.write(sql.replace("%%", "%"))


if __name__ == "__main__":
    main()
