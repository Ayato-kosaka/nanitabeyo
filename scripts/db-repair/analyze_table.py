#!/usr/bin/env python3
"""指定したテーブルの **プランナ統計** を取り直す（ANALYZE）。

## なぜ要るのか

2026-08-27、dev の近傍検索を EXPLAIN ANALYZE で測ったところ、
`idx_restaurants_location`（GIST）は選ばれているのに **見積もり行数が半径によらず
いつも `rows=57`** だった（実際は 726 / 21,247 / 119,945 件）。

これは `restaurants.location` に **統計が無い**ことを意味する。索引を
`CREATE INDEX` しても統計は付かないので、`ANALYZE` を別に走らせる必要がある。
見積もりが外れているとプランナが結合順や走査方法を誤り、索引があるのに遅いままになる。

## これは «変更» ではない

`ANALYZE` は統計だけを取り直す。行も、列も、索引も、制約も 1 つも変わらない。
migration ではないので履歴にも残さない。実行時に軽いロックを取るだけで、
読み書きは止まらない。

## 安全装置

- **`public` を拒否する。** 本番の保守はリリース手順の側で行う
- **テーブル名は allowlist でしか受け付けない。** 任意の識別子を SQL へ埋め込ませない

## 使い方

    python scripts/db-repair/analyze_table.py --schema dev --table restaurants

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import sys

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 任意の識別子を埋め込ませないための allowlist。必要になったらここへ足す
ALLOWED_TABLES = {"restaurants", "dish_media", "dish_reviews", "dishes"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--table", action="append", required=True, dest="tables")
    args = parser.parse_args()

    if args.schema == "public":
        logger.error("❌ public は対象外です")
        return 1

    unknown = [t for t in args.tables if t not in ALLOWED_TABLES]
    if unknown:
        logger.error("❌ allowlist に無いテーブルです: %s", ", ".join(unknown))
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    conn = psycopg2.connect(database_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    with conn.cursor() as cur:
        cur.execute(f'SET search_path TO "{args.schema}", extensions')
        cur.execute("SELECT current_user, current_database()")
        user, database = cur.fetchone()
        logger.info("接続先: user=%s db=%s schema=%s", user, database, args.schema)
        logger.info("")

        for table in args.tables:
            cur.execute(
                "SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables "
                "WHERE schemaname = %s AND relname = %s",
                (args.schema, table),
            )
            before = cur.fetchone()
            logger.info("▶ ANALYZE %s（実行前: last_analyze=%s / last_autoanalyze=%s）",
                        table, before[0] if before else None, before[1] if before else None)

            cur.execute(f'ANALYZE "{args.schema}"."{table}"')

            cur.execute(
                "SELECT last_analyze FROM pg_stat_user_tables "
                "WHERE schemaname = %s AND relname = %s",
                (args.schema, table),
            )
            after = cur.fetchone()
            logger.info("   ✅ 完了（last_analyze=%s）", after[0] if after else None)

    conn.close()
    logger.info("")
    logger.info("`scripts/db-checks/measure_restaurants_nearby.py` で測り直すこと")
    return 0


if __name__ == "__main__":
    sys.exit(main())
