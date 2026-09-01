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

            # #1706 **«アプリ製の行に値が入っていたら異常» という検査はもう成り立たない。**
            #
            # かつてはそれで良かった。同期がアプリ製の行に一切触らなかったからである。
            # いまは **オーナー承認のうえで 2 つだけ意図的に埋めている**。
            #
            #   ・address     … catalog にあってアプリ製の行が **NULL のときだけ**埋める（1-a）
            #   ・country_code … その行自身の address_components から埋める（9_9 の backfill）
            #
            # そのため «件数が 0 か» で判定すると、**正しい振る舞いで赤くなる**。
            # 赤いのが常態になった検査は、そのうち誰も読まなくなる。
            #
            # 見るべきは «値があるか» ではなく **«ユーザーのものが catalog のもので
            # 潰されていないか»** である。次の 2 つはコードが不変条件として守っている
            # ので、破れていれば本当に事故である。
            cursor.execute(
                """
                SELECT
                  -- 同期は pipeline の行にしか row_hash を刻まない。アプリ製の行に
                  -- 付いていたら、その行は «同期の管理下» に入ってしまっている
                  COUNT(*) FILTER (WHERE source_row_hash IS NOT NULL)          AS hashed,
                  -- catalog の image_url は全行 空文字。アプリ製の行が空になって
                  -- いたら、表示値 UPDATE がアプリ製の行を掴んだということ
                  COUNT(*) FILTER (WHERE NULLIF(btrim(image_url), '') IS NULL) AS blanked_image
                FROM restaurants
                WHERE created_by_source <> 'pipeline'
                """
            )
            hashed, blanked_image = cursor.fetchone()
            if hashed or blanked_image:
                LOGGER.error(
                    "❌ アプリ製の行が同期に踏まれています: row_hash 付き %d 件 / "
                    "画像が空になった行 %d 件",
                    hashed, blanked_image,
                )
            else:
                LOGGER.info(
                    "✅ アプリ製の行は同期に踏まれていない"
                    "（row_hash 0 件 / 画像が空になった行 0 件）"
                )
                LOGGER.info(
                    "   ※ 住所と国コードは **意図的に穴埋めしている**ので、"
                    "件数があるのが正常（#1706 の 1-a）"
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
