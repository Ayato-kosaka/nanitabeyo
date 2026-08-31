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
    parser.add_argument("--which", choices=("work", "moved"), required=True)
    args = parser.parse_args()

    table = f"restaurant_sync_{args.which}"
    src = SOURCE.read_text(encoding="utf-8")
    hits = re.findall(
        r'"""\s*(CREATE TEMP TABLE ' + table + r' ON COMMIT DROP AS.*?)"""', src, re.S
    )
    if len(hits) != 1:
        sys.exit(f"{table} の SQL を一意に取れませんでした（{len(hits)}件）")
    sys.stdout.write(hits[0])


if __name__ == "__main__":
    main()
