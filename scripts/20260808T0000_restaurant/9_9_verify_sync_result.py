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
            for src, total, addr, cc, seed, names in cursor.fetchall():
                LOGGER.info("  %-10s %8d %8d %8d %8d %8d", src, total, addr, cc, seed, names)

            # #1706 **«アプリ製の行に値が入っていたら異常» という検査は成り立たない。**
            #
            # かつてはそれで良かった。同期がアプリ製の行に一切触らなかったからで
            # ある。いまは **オーナー承認のうえで 2 つだけ意図的に埋めている**
            # （住所の穴埋め 1-a と、その行自身の address_components からの国コード）。
            # «件数が 0 か» で判定すると **正しい振る舞いで赤くなる**。
            # 赤いのが常態になった検査は、そのうち誰も読まなくなる。
            #
            # 見るのは «値があるか» ではなく **«上書き事故の痕跡があるか»** である。
            #
            # ⚠️ **痕跡は «画像が空» ではない。** 2026-09-01 にそう書いて誤検知した。
            # `image_url` は DEPRECATED（20251112T1100）で、いまのアプリは
            # `image_path` に書いて `image_url` を空のままにする。dev 実測で 40 件
            # あり、**全件が image_path を持っていた**（＝正常なアプリ製の行）。
            #
            # 表示値 UPDATE がアプリ製の行を掴んだ場合、catalog の値が入るので
            # **image_url が空 かつ image_path が NULL** になる。両方揃ってはじめて
            # 事故の痕跡である。
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (
                    WHERE NULLIF(btrim(image_url), '') IS NULL AND image_path IS NULL
                  )                                                      AS media_wiped,
                  COUNT(*) FILTER (
                    WHERE NULLIF(btrim(image_url), '') IS NULL AND image_path IS NOT NULL
                  )                                                      AS path_only,
                  COUNT(*) FILTER (WHERE source_row_hash IS NOT NULL)    AS hashed
                FROM restaurants
                WHERE created_by_source <> 'pipeline'
                """
            )
            media_wiped, path_only, hashed = cursor.fetchone()

            # #1706 ⚠️ **«画像が無い» を ERROR にしてはいけない。**
            #
            # 2026-09-02 の本番同期でここが 2 件で赤くなった。調べた結果、
            # **アプリが画像なしで店を作れる**（写真の無い POI を選んだ場合）ので、
            # 両方が空なのは正当な状態だった。作成は 2025-12〜2026-08 で、
            # 同期直前の backup と全 106,653 行を突き合わせて **変化 0 件**を確認。
            #
            # 上書き事故を防ぐ役目は、この検査ではなく **9_1 の WHERE 句**が
            # 持っている（値 UPDATE は created_by_source='pipeline' 限定）。
            # それは実物の PostgreSQL で固定済み（test_9_1_overwrite_guard.sh 6/6、
            # test_9_1_display_update.sh §4）。
            #
            # スナップショット 1 枚から «触られたか» は判定できない。判定できる
            # ふりをして ERROR を出すと、**正しい振る舞いで赤くなる検査**になり、
            # そのうち誰も読まなくなる。ここは数えて出すだけにする。
            #
            # 本当に確かめたいときは 9_9_compare_with_backup.py を使う。
            # 同期直前の backup が «触る前» の姿なので、事実で言える。
            LOGGER.info(
                "   画像が全く無いアプリ製の行: %d 件"
                "（アプリは画像なしでも店を作れる。上書き事故の判定には使えない）",
                media_wiped,
            )
            LOGGER.info(
                "   image_path だけ持つ行: %d 件（image_url は DEPRECATED。正常）",
                path_only,
            )
            LOGGER.info(
                "   row_hash が付いたアプリ製の行: %d 件"
                "（過去の版が付けた古い足あと。いまのコードは新たに刻まない）",
                hashed,
            )
            LOGGER.info(
                "   ※ «同期が既存行を触っていないこと» を事実で確かめるには "
                "9_9_compare_with_backup.py を使う（同期直前の backup と突き合わせる）"
            )

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
