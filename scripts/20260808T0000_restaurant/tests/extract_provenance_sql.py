#!/usr/bin/env python3
"""9_1 の provenance UPDATE と synced_at UPDATE をソースから抜き出す。

#843 写経しない。`--which provenance|synced_at`。
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
        "--which",
        choices=("provenance", "seed_update", "synced_at", "address_fill", "display"),
        required=True,
    )
    args = parser.parse_args()

    src = SOURCE.read_text(encoding="utf-8")
    found = re.findall(r'"""\s*(UPDATE restaurants r\s+SET[^"]*?)"""', src, re.S)
    if args.which == "provenance":
        hit = [q for q in found if "source_names = ARRAY(" in q]
    elif args.which == "seed_update":
        # 索引の付いた列だけを書く別文（#1706 で provenance から分離した）
        hit = [q for q in found if "SET source_seed_id = s.seed_id" in q]
    elif args.which == "display":
        hit = [q for q in found if "name_language_code = s.name_language_code" in q]
    elif args.which == "address_fill":
        hit = [q for q in found if "SET address = s.address" in q]
    else:
        hit = [q for q in found if q.strip().startswith("UPDATE restaurants r\n            SET synced_at")]
    if len(hit) != 1:
        sys.exit(f"{args.which} の SQL を一意に取れませんでした（{len(hit)}件）")
    sys.stdout.write(hit[0].replace("%%", "%"))


if __name__ == "__main__":
    main()
