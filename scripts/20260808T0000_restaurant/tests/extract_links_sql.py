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

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / "9_1_sync_restaurants.py"
BACKFILL = HERE / "9_9_backfill_restaurant_links.py"

PATTERNS = {
    "delete": (SOURCE, r'"""\s*(DELETE FROM restaurant_links.*?)"""'),
    "insert": (SOURCE, r'"""\s*(INSERT INTO restaurant_links.*?)"""'),
    # #1706 埋め直しの «対象の集め方»。ここを写経すると、9_1 を直したときに
    # 埋め直し側だけ古い条件のまま緑になる。
    "backfill_target": (
        BACKFILL,
        r'"""\s*(CREATE TEMP TABLE restaurant_link_backfill_all.*?)"""',
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--which", choices=sorted(PATTERNS), required=True)
    args = parser.parse_args()

    source, pattern = PATTERNS[args.which]
    src = source.read_text(encoding="utf-8")
    found = re.findall(pattern, src, re.S)
    if len(found) != 1:
        sys.exit(f"{args.which} の SQL を一意に取れませんでした（{len(found)}件）")
    # psycopg2 のリテラル %% は psql では % 一つ
    sys.stdout.write(found[0].replace("%%", "%"))


if __name__ == "__main__":
    main()
