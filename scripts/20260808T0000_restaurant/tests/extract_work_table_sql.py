#!/usr/bin/env python3
"""9_1 の作業表 CREATE を、ソースから抜き出して出力する。#1706

写経しない（CLAUDE.md）。`--which work|moved`。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--which", choices=("work", "moved", "override_fix", "unlink"), required=True
    )
    args = parser.parse_args()

    src = SOURCE.read_text(encoding="utf-8")

    if args.which in ("work", "moved"):
        # #1706 «全体» は *_all という名前で作り、回ごとの部分集合を
        # materialize_chunk が同じ名前へ切り出す。抽出するのは «全体» の方。
        table = f"restaurant_sync_{args.which}_all"
        hits = re.findall(
            r'"""\s*(CREATE TEMP TABLE ' + table + r' AS.*?)"""', src, re.S
        )
    else:
        found = re.findall(r'"""\s*(UPDATE restaurants r\s+SET[^"]*?)"""', src, re.S)
        if args.which == "override_fix":
            hits = [q for q in found if "SET google_place_id = s.google_place_id" in q]
        else:
            hits = [q for q in found if "SET source_seed_id = NULL" in q]

    if len(hits) != 1:
        sys.exit(f"{args.which} の SQL を一意に取れませんでした（{len(hits)}件）")
    sys.stdout.write(hits[0])


if __name__ == "__main__":
    main()
