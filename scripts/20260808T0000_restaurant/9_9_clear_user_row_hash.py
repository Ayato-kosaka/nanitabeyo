#!/usr/bin/env python3
"""アプリ製の行に残った古い `source_row_hash` を消す。#1706

## なぜ消すのか

2026-09-01 の dev 実測で **2,115 件**見つかった。過去の版の同期が、アプリ製の
行にも無条件で row_hash を刻んでいた時代の名残である（作成 2025-10-13〜
2026-08-23。直近 24 時間に作られた行は 0 件）。表示値は無傷なので**いまは実害が
無い**が、放置すると次の形で壊れる。

    その行の created_by_source が 'pipeline' へ変わった瞬間、
    値 UPDATE の条件 `source_row_hash IS DISTINCT FROM s.row_hash` が
    **最初から偽**になり、その行だけオープンデータの更新が永久に届かなくなる。

落ちず、壊れず、気付けない種類の不整合なので、実害が出る前に消す。

## 何を消して、何を残すか

**消すのは `source_row_hash` だけ。** `source_seed_id` は «どの seed が根拠か» の
記録として正しいので残す。表示値（name / image / address など）には一切触らない。

対象は `created_by_source <> 'pipeline'` の行だけ。パイプライン製の行の hash は
同期の判定に使うので消してはいけない。

    9_9_clear_user_row_hash.py --schema dev            数えるだけ
    9_9_clear_user_row_hash.py --schema dev --apply    実際に消す
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres, log_db_load  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

CLEAR_SQL = """
UPDATE restaurants
SET source_row_hash = NULL
WHERE created_by_source <> 'pipeline'
  AND source_row_hash IS NOT NULL
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="アプリ製の行に残った古い source_row_hash を消します"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--apply", action="store_true", help="指定したときだけ commit する")
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        log_db_load(connection, "開始前")
        with connection.cursor() as cursor:
            # 消す前に «表示値が無傷であること» を数える。ここが 0 でないなら、
            # 消すより先に上書き事故を調べるべきなので中断する。
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE source_row_hash IS NOT NULL) AS target,
                  COUNT(*) FILTER (
                    WHERE source_row_hash IS NOT NULL
                      AND NULLIF(btrim(image_url), '') IS NULL
                      AND image_path IS NULL
                  ) AS media_wiped
                FROM restaurants
                WHERE created_by_source <> 'pipeline'
                """
            )
            target, media_wiped = cursor.fetchone()
            LOGGER.info("対象（アプリ製 × row_hash あり）: %s 件", f"{target:,}")
            if media_wiped:
                raise RuntimeError(
                    f"対象のうち {media_wiped} 件で画像が丸ごと消えています。"
                    "hash を消す前に上書き事故を調べてください（#1706）"
                )
            LOGGER.info("対象の表示値は無傷（画像が消えた行 0 件）")

            if target == 0:
                LOGGER.info("消すものはありません")
                return

            cursor.execute(CLEAR_SQL)
            cleared = cursor.rowcount
            LOGGER.info("消した件数: %s", f"{cleared:,}")
            if cleared != target:
                raise RuntimeError(
                    f"数えた {target} 件と消した {cleared} 件が一致しません。中断します"
                )

            # 消したあとも seed と表示値が残っていることを確かめる。
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE source_row_hash IS NOT NULL),
                  COUNT(*) FILTER (WHERE source_seed_id IS NOT NULL)
                FROM restaurants WHERE created_by_source <> 'pipeline'
                """
            )
            left_hash, seeds = cursor.fetchone()
            LOGGER.info("消した後: row_hash %s 件 / seed %s 件（seed は残す）",
                        f"{left_hash:,}", f"{seeds:,}")

        if args.apply:
            connection.commit()
            LOGGER.info("✅ commit しました")
        else:
            connection.rollback()
            LOGGER.info("dry-run のため rollback しました（適用するには --apply）")
        log_db_load(connection, "終了後")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
