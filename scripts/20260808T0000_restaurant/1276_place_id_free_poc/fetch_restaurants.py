#!/usr/bin/env python3
"""restaurants テーブルを全行 CSV へ書き出す（Issue #1261 突合用）。

PR #1275 (results/matched_place_ids.csv) の google_place_id を既存 restaurants と
座標距離で突合するための入力を用意する。COPY で直接 STDOUT へストリームするため、
件数に依らずPython側のメモリへ全行を載せない。
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg2
from psycopg2 import sql

ALLOWED_SCHEMAS = {"dev", "public"}
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "out" / "restaurants.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="restaurants テーブルを全行 CSV へ書き出します"
    )
    parser.add_argument("--schema", default="public", choices=sorted(ALLOWED_SCHEMAS))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL が必要です")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    copy_sql = sql.SQL(
        "COPY (SELECT * FROM {}.restaurants ORDER BY id) TO STDOUT WITH (FORMAT CSV, HEADER TRUE)"
    ).format(sql.Identifier(args.schema))

    with psycopg2.connect(database_url, connect_timeout=15) as connection:
        with connection.cursor() as cursor:
            with args.output.open("w", encoding="utf-8", newline="") as stream:
                cursor.copy_expert(copy_sql.as_string(connection), stream)
            row_count = cursor.rowcount

    print(f"{args.schema}.restaurants -> {args.output} ({row_count} rows)")


if __name__ == "__main__":
    main()
