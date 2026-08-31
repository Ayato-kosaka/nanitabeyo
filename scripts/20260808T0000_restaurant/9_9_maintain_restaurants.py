#!/usr/bin/env python3
"""restaurants の «物理的な健康状態» を測り、必要なら VACUUM する。#1706

## なぜ要るか

2026-08-31 に 9_1 が 3 回続けて statement timeout に当たった。3 回目は
**`SELECT COUNT(*) FROM restaurants` が 30 分で終わらなかった**。62 万行の
COUNT にそんな時間はかからない。原因は SQL ではなく、表そのものである。

9_1 は 1 トランザクションなので、失敗すれば内容は巻き戻る。しかし
**巻き戻っても、書きかけた行のバージョンは «死んだ行» として表に残る**。
62 万行を書き換えて失敗した実行が 2 回あれば、62 万行の表に 120 万行ぶんの
死骸が積む。以後の全ての走査がその分だけ遅くなり、次の同期も落ちる
——という悪循環になる。autovacuum は追いつくまで時間がかかる。

**同期が失敗したら、次を流す前にここを見る。** 数字を見ずに «もう一度流す»
のは、遅くなった表をさらに膨らませるだけである。

## 使い方

    9_9_maintain_restaurants.py --schema dev              測るだけ（既定）
    9_9_maintain_restaurants.py --schema dev --vacuum     VACUUM (ANALYZE) も行う

`--vacuum` は `VACUUM (ANALYZE)` であって `VACUUM FULL` ではない。表を
ロックせず、オンラインで死骸を «再利用可能» にする。ディスクは OS へ
返らないが、走査の対象からは外れるので速度は戻る。
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

TABLES = ("restaurants", "restaurant_links")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="restaurants の肥大を測り、必要なら VACUUM します"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--vacuum",
        action="store_true",
        help="VACUUM (ANALYZE) を実行する。指定しなければ測るだけ",
    )
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def schema_ident(*, schema: str) -> str:
    """スキーマ名を識別子として埋め込む前に、想定の 2 つに限る。"""

    if schema not in ("dev", "public"):
        raise ValueError(f"想定外のschemaです: {schema}")
    return schema


def report(cursor: Any, schema: str) -> None:
    for table in TABLES:
        cursor.execute(
            """
            SELECT
              c.reltuples::BIGINT                              AS planner_rows,
              s.n_live_tup, s.n_dead_tup,
              pg_size_pretty(pg_table_size(c.oid))             AS table_size,
              pg_size_pretty(pg_indexes_size(c.oid))           AS index_size,
              s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
            WHERE n.nspname = %s AND c.relname = %s
            """,
            (schema, table),
        )
        row = cursor.fetchone()
        if row is None:
            LOGGER.warning("%s: 見つかりません", table)
            continue
        (planner, live, dead, tsize, isize, lv, lav, la, laa) = row
        live = live or 0
        dead = dead or 0
        ratio = (dead / (live + dead) * 100) if (live + dead) else 0.0
        LOGGER.info("%s", table)
        LOGGER.info("  生きている行         %12s", f"{live:,}")
        LOGGER.info("  死んだ行             %12s  (%.1f%%)", f"{dead:,}", ratio)
        LOGGER.info("  planner が見る行数   %12s", f"{planner:,}")
        LOGGER.info("  表の大きさ / 索引     %12s / %s", tsize, isize)
        LOGGER.info("  最終 vacuum          手動=%s / auto=%s", lv, lav)
        LOGGER.info("  最終 analyze         手動=%s / auto=%s", la, laa)
        if ratio >= 20.0:
            LOGGER.warning(
                "  ⚠️ 死骸が %.1f%% を占めています。同期を流す前に --vacuum してください",
                ratio,
            )


def measure_scan(cursor: Any, schema: str) -> None:
    """実際に «遅い» のかを 1 本の走査で測る（9_1 が落ちた文と同じ形）。"""

    started = time.monotonic()
    cursor.execute(
        f"SELECT COUNT(*) FROM {schema}.restaurants WHERE created_by_source = 'pipeline'"
    )
    count = cursor.fetchone()[0]
    LOGGER.info(
        "pipeline 行の COUNT: %s 行 / %.1f秒（9_1 が 30 分で落ちた文と同じ形）",
        f"{count:,}",
        time.monotonic() - started,
    )


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            LOGGER.info("=== VACUUM 前 ===")
            report(cursor, args.schema)
            measure_scan(cursor, args.schema)
        connection.rollback()

        if not args.vacuum:
            LOGGER.info("測定のみで終了しました（VACUUM するには --vacuum）")
            return

        # VACUUM はトランザクション内で実行できない。
        connection.autocommit = True
        for table in TABLES:
            # ⚠️ **表名は必ずスキーマで修飾する。search_path に頼らない。**
            #
            # PostgreSQL の `SET`（LOCAL 無し）は **トランザクションの一部**で、
            # ROLLBACK で巻き戻る。connect_postgres が接続時に張った
            # `SET search_path TO dev, public` は、上の rollback() で消えていた。
            # その状態で `VACUUM restaurants` を流したところ、既定の
            # search_path が効いて **public.restaurants** に当たった
            # （2026-08-31 に実際に起きた。VACUUM なのでデータは変わらないが、
            # 意図した対象ではなかった）。
            target = f"{schema_ident(schema=args.schema)}.{table}"
            started = time.monotonic()
            with connection.cursor() as cursor:
                cursor.execute(f"VACUUM (ANALYZE) {target}")
            LOGGER.info("VACUUM (ANALYZE) %s: %.1f秒", target, time.monotonic() - started)
        connection.autocommit = False

        with connection.cursor() as cursor:
            LOGGER.info("=== VACUUM 後 ===")
            report(cursor, args.schema)
            measure_scan(cursor, args.schema)
        connection.rollback()
    finally:
        connection.close()


if __name__ == "__main__":
    main()
