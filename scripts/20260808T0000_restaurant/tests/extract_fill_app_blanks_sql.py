#!/usr/bin/env python3
"""9_1 の «アプリ製の行の空欄 UPDATE» を、**ソースから**抜き出して psql へ渡す。

## なぜ要るか

この文の値は «上書きしない» ことに全部かかっている（`COALESCE(NULLIF(...))`）。
写経すると、本番の COALESCE を崩しても **テストは古い形を守ったまま緑**になる。
2026-09-23 に値 UPDATE で実際にそれが起きた（→ `extract_value_update_sql.py`）。

`extract_links_sql.py` / `extract_value_update_sql.py` と同じ作法である。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"

LABEL = "アプリ製の行の空欄 UPDATE"
TEMPLATE = re.compile(
    rf'"{LABEL}",\s*"""\s*(UPDATE restaurants r.*?)"""', re.S
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--keep-range",
        action="store_true",
        help="バッチの範囲条件（%%(lo)s / %%(hi)s）を残す。既定は落とす（psql が解釈できないため）",
    )
    args = parser.parse_args()

    found = TEMPLATE.findall(SOURCE.read_text(encoding="utf-8"))
    if len(found) != 1:
        sys.exit(f"«{LABEL}» の SQL を一意に取れませんでした（{len(found)}件）")

    sql = found[0]
    if not args.keep_range:
        # psql は psycopg2 の名前付きプレースホルダを解釈できない。
        # ⚠️ «範囲条件が付いていること» は test_9_1_batched_statements.py が縛る。
        sql = re.sub(r"\n\s*AND s\.google_place_id (>|<=) %\(\w+\)s", "", sql)

    sys.stdout.write(sql.replace("%%", "%"))


if __name__ == "__main__":
    main()
