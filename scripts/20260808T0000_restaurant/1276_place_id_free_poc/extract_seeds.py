#!/usr/bin/env python3
"""巨大な seed CSV から、指定した seed_id の行だけを抜き出す。"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--ids", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    wanted = {line.strip() for line in arguments.ids.read_text().splitlines() if line.strip()}
    with arguments.seeds.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        rows = [row for row in reader if row["seed_id"] in wanted]
        fields = reader.fieldnames
    with arguments.output.open("w", encoding="utf-8", newline="") as sink:
        writer = csv.DictWriter(sink, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"要求 {len(wanted):,} 件 / 見つかった {len(rows):,} 件 -> {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
