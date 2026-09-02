#!/usr/bin/env python3
"""public に必要な列・表が揃っているかを確かめる（読み取り専用）。#1706

`9_1` を public へ流す前に、**列が無くて途中で落ちる**ことを避ける。
落ちてもデータは変わらないが、共有 DB を無駄に掴むので事前に見る。

**1 行も書き換えない。カタログもデータも読まない。情報スキーマだけを見る。**
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 9_1 が読み書きする列。migration との対応を併記する。
REQUIRED_COLUMNS = {
    "restaurants": [
        ("source_seed_id", "20260823T0000"),
        ("source_names", "20260823T0000"),
        ("source_row_hash", "20260823T0000"),
        ("synced_at", "20260823T0000"),
        ("created_by_source", "20260827T0000"),
        ("address", "20260828T0000"),
        ("country_code", "20260828T0000"),
    ],
}
REQUIRED_TABLES = [("restaurant_links", "20260828T0000")]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="同期に必要な列・表が揃っているかを見ます（読み取り専用）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    missing: list[str] = []
    try:
        with connection.cursor() as cursor:
            for table, columns in REQUIRED_COLUMNS.items():
                cursor.execute(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    """,
                    (args.schema, table),
                )
                present = {r[0] for r in cursor.fetchall()}
                LOGGER.info("=== %s.%s ===", args.schema, table)
                for column, migration in columns:
                    ok = column in present
                    LOGGER.info("  %-20s %s  (%s)", column, "✅" if ok else "❌ 無い", migration)
                    if not ok:
                        missing.append(f"{table}.{column}（{migration}）")

            for table, migration in REQUIRED_TABLES:
                cursor.execute(
                    """
                    SELECT COUNT(*) FROM information_schema.tables
                    WHERE table_schema = %s AND table_name = %s
                    """,
                    (args.schema, table),
                )
                ok = cursor.fetchone()[0] > 0
                LOGGER.info("=== %s.%s === %s  (%s)", args.schema, table,
                            "✅" if ok else "❌ 無い", migration)
                if not ok:
                    missing.append(f"{table}（{migration}）")

            # 参考: 行数（同期後の insert 見込みを読むため）
            cursor.execute(f"SELECT COUNT(*) FROM {args.schema}.restaurants")
            LOGGER.info("%s.restaurants の行数: %s", args.schema, f"{cursor.fetchone()[0]:,}")
            if "created_by_source" not in missing:
                try:
                    cursor.execute(
                        f"SELECT created_by_source, COUNT(*) FROM {args.schema}.restaurants"
                        " GROUP BY 1 ORDER BY 2 DESC"
                    )
                    for src, n in cursor.fetchall():
                        LOGGER.info("  %-10s %s", src, f"{n:,}")
                except Exception as error:
                    LOGGER.warning("内訳を取れませんでした: %s", error)
        connection.rollback()
    finally:
        connection.close()

    if missing:
        raise RuntimeError(
            "同期に必要なものが揃っていません: " + " / ".join(missing)
            + "。先に該当 migration を適用してください"
        )
    LOGGER.info("✅ 同期に必要な列・表は揃っています")


if __name__ == "__main__":
    main()
