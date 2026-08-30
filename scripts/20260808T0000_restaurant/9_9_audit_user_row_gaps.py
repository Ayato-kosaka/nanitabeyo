#!/usr/bin/env python3
"""アプリ製の行に «穴» が空いていないかを数える（読み取り専用）。#1681

## なぜ要るか

9_1 は
  ・INSERT … ON CONFLICT (google_place_id) DO NOTHING
  ・値 UPDATE … created_by_source = 'pipeline' の行だけ
なので、**アプリが作った行はどちらの経路でも address / country_code を受け取れない**。
上書き事故を防ぐ性質と、穴が埋まらない性質は同じ 1 つの条件の裏表である。

一方 restaurant_links の INSERT は google_place_id で join するだけで
created_by_source を見ていないので、**アプリ製の行にも電話・サイト・SNS が付く**。

どちらも «そう書いたから» ではなく実データで確かめる。**1 行も書き換えない。**
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
    parser = argparse.ArgumentParser(description="アプリ製行の穴を数えます")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            # (a) アプリ製の行のうち、seed が付いた＝catalog に同じ店が居る行
            cursor.execute(
                """
                SELECT
                  COUNT(*) AS user_rows,
                  COUNT(*) FILTER (WHERE source_seed_id IS NOT NULL) AS matched_to_catalog,
                  COUNT(*) FILTER (WHERE address IS NOT NULL) AS has_address,
                  COUNT(*) FILTER (WHERE country_code IS NOT NULL) AS has_country
                FROM restaurants WHERE created_by_source <> 'pipeline'
                """
            )
            user_rows, matched, addr, cc = cursor.fetchone()
            LOGGER.info("=== アプリ製の行（created_by_source <> 'pipeline'） ===")
            LOGGER.info("  行数                      : %d", user_rows)
            LOGGER.info("  catalog に同じ店が居る    : %d", matched)
            LOGGER.info("  address が入っている      : %d", addr)
            LOGGER.info("  country_code が入っている : %d", cc)
            LOGGER.info(
                "  → **穴**: catalog に値があるのに埋まっていない行 = %d", matched - addr
            )

            # (b) アプリ製の行に restaurant_links は付いたか
            cursor.execute(
                """
                SELECT l.kind, COUNT(*) AS links, COUNT(DISTINCT r.id) AS stores
                FROM restaurants r JOIN restaurant_links l ON l.restaurant_id = r.id
                WHERE r.created_by_source <> 'pipeline'
                GROUP BY 1 ORDER BY 2 DESC
                """
            )
            rows = cursor.fetchall()
            LOGGER.info("")
            LOGGER.info("=== アプリ製の行に付いた restaurant_links ===")
            if not rows:
                LOGGER.info("  0 件（＝リンクも付いていない）")
            for kind, links, stores in rows:
                LOGGER.info("  %-10s %6d件 / %5d店", kind, links, stores)

            # (c) 次回の同期はどれくらい動くか（row_hash が一致していれば skip）
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE source_row_hash IS NOT NULL) AS has_hash,
                  COUNT(*) AS pipeline_rows
                FROM restaurants WHERE created_by_source = 'pipeline'
                """
            )
            has_hash, pipeline_rows = cursor.fetchone()
            LOGGER.info("")
            LOGGER.info("=== 次回同期の見込み ===")
            LOGGER.info("  pipeline 行 %d のうち row_hash を持つ行 %d", pipeline_rows, has_hash)
            LOGGER.info("  → catalog が変わらなければ、この行数はすべて skip になる")
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
