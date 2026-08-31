#!/usr/bin/env python3
"""restaurants の «全列 × 全母集団» の充足を数える（読み取り専用）。#1706

## なぜ要るか

「アプリ製の行の address が 0 件」は、見方を変えれば
«ガードが効いている» でもあり «住所が欠けている» でもある。
**片面だけ報告すると欠損を成果に見せてしまう。**

そこで «どの列が / どの母集団で / 何行埋まっているか» を機械的に全部出す。
解釈は人間が行う。**1 行も書き換えない。**
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 「埋まっている」の定義を列ごとに書く。NOT NULL でも空文字・空配列・'[]' は «無い»。
COLUMNS = [
    ("name", "NULLIF(btrim(name), '') IS NOT NULL"),
    ("name_language_code", "NULLIF(btrim(name_language_code), '') IS NOT NULL"),
    ("latitude/longitude", "latitude IS NOT NULL AND longitude IS NOT NULL"),
    ("address", "NULLIF(btrim(address), '') IS NOT NULL"),
    ("country_code", "country_code IS NOT NULL"),
    ("image_url", "NULLIF(btrim(image_url), '') IS NOT NULL"),
    ("image_path", "NULLIF(btrim(image_path), '') IS NOT NULL"),
    ("address_components", "address_components IS NOT NULL AND address_components::text NOT IN ('[]','null')"),
    ("plus_code", "plus_code IS NOT NULL"),
    ("source_seed_id", "source_seed_id IS NOT NULL"),
    ("source_names", "cardinality(source_names) > 0"),
    ("source_row_hash", "source_row_hash IS NOT NULL"),
    ("synced_at", "synced_at IS NOT NULL"),
]

LINK_KINDS = ["phone", "website", "instagram", "x", "tiktok", "facebook", "other"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="列の充足を数えます（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection: Any = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT created_by_source, COUNT(*) FROM restaurants GROUP BY 1 ORDER BY 2 DESC"
            )
            groups = cursor.fetchall()
            LOGGER.info("=== 母集団 ===")
            for src, cnt in groups:
                LOGGER.info("  %-10s %8d 行", src, cnt)

            LOGGER.info("")
            LOGGER.info("=== 列の充足（埋まっている行数 / 母集団）===")
            header = "  %-22s" + "".join(f" {src:>16}" for src, _ in groups)
            LOGGER.info(header, "列")
            for label, predicate in COLUMNS:
                parts = []
                for src, total in groups:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM restaurants "
                        f"WHERE created_by_source = %s AND ({predicate})"
                    , (src,))
                    filled = cursor.fetchone()[0]
                    pct = (filled / total * 100) if total else 0.0
                    parts.append(f"{filled:>8} ({pct:5.1f}%)")
                LOGGER.info("  %-22s" + " %s" * len(parts), label, *parts)

            LOGGER.info("")
            LOGGER.info("=== restaurant_links（店が 1 本以上持っている数 / 母集団）===")
            for kind in LINK_KINDS:
                parts = []
                for src, total in groups:
                    cursor.execute(
                        """
                        SELECT COUNT(DISTINCT r.id) FROM restaurants r
                        JOIN restaurant_links l ON l.restaurant_id = r.id AND l.kind = %s
                        WHERE r.created_by_source = %s
                        """,
                        (kind, src),
                    )
                    filled = cursor.fetchone()[0]
                    pct = (filled / total * 100) if total else 0.0
                    parts.append(f"{filled:>8} ({pct:5.1f}%)")
                LOGGER.info("  %-22s" + " %s" * len(parts), kind, *parts)
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
