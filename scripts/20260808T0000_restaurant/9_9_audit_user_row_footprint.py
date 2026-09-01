#!/usr/bin/env python3
"""アプリ製の行に残っている «同期の足あと» を調べる（読み取り専用）。#1706

2026-09-01 の dev 同期後、検査が次を報告した。

    アプリ製の行: row_hash 付き 2,115 件 / 画像が空になった行 40 件

**今夜の同期が付けたのか、以前から在ったのかを、決めつけずに調べる。**
判断材料は `created_at`（行が生まれた時刻）と、同期の実行窓である。

- 実行窓より **前** に作られた行なら、今夜の同期の産物ではない
- 実行窓の **中** で作られた行なら、今夜の同期が触った可能性がある

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
    parser = argparse.ArgumentParser(
        description="アプリ製の行に残る同期の足あとを調べます（読み取り専用）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--examples", type=int, default=10)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            for label, predicate in (
                ("row_hash が付いている", "source_row_hash IS NOT NULL"),
                ("画像が空", "NULLIF(btrim(image_url), '') IS NULL"),
            ):
                cursor.execute(
                    f"""
                    SELECT
                      COUNT(*)                                   AS total,
                      MIN(created_at)                            AS oldest,
                      MAX(created_at)                            AS newest,
                      COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 day')
                                                                 AS created_last_day,
                      COUNT(*) FILTER (WHERE image_path IS NOT NULL)
                                                                 AS has_image_path
                    FROM restaurants
                    WHERE created_by_source <> 'pipeline' AND {predicate}
                    """
                )
                total, oldest, newest, last_day, has_path = cursor.fetchone()
                LOGGER.info("=== アプリ製 × %s ===", label)
                LOGGER.info("  件数                 %s", f"{total:,}")
                LOGGER.info("  行が作られた時刻     最古=%s / 最新=%s", oldest, newest)
                LOGGER.info("  直近 24 時間に作成   %s ← 今夜の同期より後に生まれた行", f"{last_day:,}")
                LOGGER.info("  image_path を持つ    %s", f"{has_path:,}")

                cursor.execute(
                    f"""
                    SELECT google_place_id, left(name, 24), created_at, synced_at,
                           left(coalesce(image_url, '(null)'), 30),
                           left(coalesce(image_path, '(null)'), 30)
                    FROM restaurants
                    WHERE created_by_source <> 'pipeline' AND {predicate}
                    ORDER BY created_at
                    LIMIT %s
                    """,
                    (args.examples,),
                )
                for gid, name, created, synced, url, path in cursor.fetchall():
                    LOGGER.info("    %s %r 作成=%s", gid, name, created)
                    LOGGER.info("        url=%s path=%s", url, path)
                LOGGER.info("")

            # 重なりを見る。両方に該当する行があるか。
            cursor.execute(
                """
                SELECT COUNT(*) FROM restaurants
                WHERE created_by_source <> 'pipeline'
                  AND source_row_hash IS NOT NULL
                  AND NULLIF(btrim(image_url), '') IS NULL
                """
            )
            LOGGER.info("両方に該当する行: %s 件", f"{cursor.fetchone()[0]:,}")
        connection.rollback()
    finally:
        connection.close()


if __name__ == "__main__":
    main()
