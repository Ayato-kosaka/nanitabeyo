#!/usr/bin/env python3
"""既に同期済みの行へ created_by_source='pipeline' を遡って刻む。

## なぜ必要か

`20260827T0000_add_restaurants_created_by_source.sql` は既定値を `'user'` に
している。これは「アプリが作った行を守る」側に倒れる安全な初期値だが、
**パイプラインが過去に投入した行も 'user' に見えてしまう**。

その状態で 9_1 を流すと、`created_by_source = 'pipeline'` の行が1件も無いので
表示値の UPDATE が一切走らない。壊れはしないが、**オープンデータの更新が
黙って止まる**。落ちるより気付きにくい。

## どうやって特定するか

「パイプラインが INSERT した行」は、同期の実行窓に作られた行である。
`restaurant_pg_sync_logs` に本番同期の開始・終了時刻が残っているので、
そこから引く。時刻をハードコードしない。

  created_at BETWEEN sync.started_at AND sync.finished_at
  AND source_seed_id IS NOT NULL

`source_seed_id IS NOT NULL` だけでは足りない。9_1 の provenance UPDATE は
**アプリ製の行にも source_seed_id を付ける**ので、既存店 2,108 行も引っかかる。
作成時刻で「同期が作った行」に絞る必要がある。

逆に `created_at` だけでも足りない。同期の実行中にアプリが店を作った可能性を
排除できないため、両方を課す。

## 検証

同期ログの inserted_count と一致することを確かめてから commit する。
一致しなければ、想定と違う行を掴んでいるので中断する。
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres, fetch_sync_windows  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="同期済みの行へ created_by_source='pipeline' を刻みます"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="指定したときだけ commit する。既定は数えるだけ",
    )
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    pipeline = BigQueryPipeline()
    windows = fetch_sync_windows(pipeline, args.schema)
    for window in windows:
        LOGGER.info(
            "同期: %s 〜 %s（inserted=%s）",
            window.started_at,
            window.finished_at,
            window.inserted_count,
        )

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        total = 0
        with connection.cursor() as cursor:
            for window in windows:
                cursor.execute(
                    """
                    UPDATE restaurants
                    SET created_by_source = 'pipeline'
                    WHERE created_by_source = 'user'
                      AND source_seed_id IS NOT NULL
                      AND created_at BETWEEN %s AND %s
                    """,
                    (window.started_at, window.finished_at),
                )
                updated = cursor.rowcount
                total += updated
                expected = window.inserted_count or 0
                LOGGER.info(
                    "  → %d行を pipeline へ（同期ログの inserted=%d）", updated, expected
                )
                # 同じ行を2回目の実行で数えないよう、既に 'pipeline' の行は
                # 対象外にしている。よって再実行時は 0 になるのが正しい。
                if updated not in (0, expected):
                    raise RuntimeError(
                        f"更新件数({updated})が同期ログの inserted_count({expected})と一致しません。"
                        "想定と違う行を掴んでいる可能性があるため中断します"
                    )

            cursor.execute(
                "SELECT created_by_source, COUNT(*) FROM restaurants GROUP BY created_by_source ORDER BY 2 DESC"
            )
            for source, count in cursor.fetchall():
                LOGGER.info("最終状態: %s = %d行", source, count)

        if args.apply:
            connection.commit()
            LOGGER.info("commit しました（合計 %d行）", total)
        else:
            connection.rollback()
            LOGGER.info("--apply が無いので rollback しました（合計 %d行が対象）", total)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
