#!/usr/bin/env python3
"""同期の結果を数える（読み取り専用）。#843 / #1681

## なぜ要るか

「同期が succeeded で終わった」は「意図どおりに入った」ではない。
2026-08-24 の事故は成功で終わった同期が 7 行を壊していた。

**アプリが作った行を触っていないこと**を、行の中身で示す必要がある。
9_1 の値 UPDATE は `created_by_source = 'pipeline'` の行にしか当たらないので、
`user` の行に `address` / `country_code` が入っていたら、それはガードが
破れた証拠になる（catalog 側は全行に値を持っているため）。

**1 行も書き換えない。**
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="同期結果を数えます（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT created_by_source, COUNT(*),
                       COUNT(*) FILTER (WHERE address IS NOT NULL),
                       COUNT(*) FILTER (WHERE country_code IS NOT NULL),
                       COUNT(*) FILTER (WHERE source_seed_id IS NOT NULL),
                       COUNT(*) FILTER (WHERE cardinality(source_names) > 0)
                FROM restaurants GROUP BY 1 ORDER BY 2 DESC
                """
            )
            LOGGER.info("restaurants（created_by_source 別）")
            LOGGER.info("  %-10s %8s %8s %8s %8s %8s", "source", "行数", "住所", "国", "seed", "名前配列")
            user_with_values = 0
            for src, total, addr, cc, seed, names in cursor.fetchall():
                LOGGER.info("  %-10s %8d %8d %8d %8d %8d", src, total, addr, cc, seed, names)
                if src != "pipeline":
                    user_with_values += addr + cc

            # ★ ここが本題。アプリ製の行に catalog の値が入っていたらガードが破れている。
            if user_with_values:
                LOGGER.error(
                    "❌ pipeline 以外の行に address/country_code が %d 件入っています。"
                    "値 UPDATE のガードが効いていません",
                    user_with_values,
                )
            else:
                LOGGER.info("✅ アプリ製の行に catalog の値は 1 件も入っていない（ガードが効いている）")

            cursor.execute(
                "SELECT kind, COUNT(*), COUNT(DISTINCT restaurant_id) FROM restaurant_links GROUP BY 1 ORDER BY 2 DESC"
            )
            LOGGER.info("")
            LOGGER.info("restaurant_links（種別 別）")
            total_links = 0
            for kind, cnt, stores in cursor.fetchall():
                LOGGER.info("  %-10s %8d件 / %7d店", kind, cnt, stores)
                total_links += cnt
            LOGGER.info("  合計 %d件", total_links)

            cursor.execute("SELECT COUNT(*) FROM restaurant_links WHERE source <> 'open_data'")
            LOGGER.info("  うち open_data 以外の出所: %d件", cursor.fetchone()[0])

            cursor.execute(
                """
                SELECT COUNT(*) FILTER (WHERE synced_at IS NULL),
                       MAX(synced_at)
                FROM restaurants
                """
            )
            never, latest = cursor.fetchone()
            LOGGER.info("")
            LOGGER.info("一度も同期されていない行: %d件 / 最新 synced_at: %s", never, latest)
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
