#!/usr/bin/env python3
"""アプリ製の行へ country_code を刻む（#1681）。

## なぜ catalog から埋めないのか

同期（9_1）はアプリ製の行を触らない。上書き事故を防ぐための設計だが、裏返すと
**アプリ製の行に country_code が永久に入らない**。dev の実測で 2,119 行が
「catalog に値があるのに埋まっていない」状態だった。

埋め方は 2 通りある。

  A. catalog（オープンデータ）から NULL の行にだけ入れる
  B. **その行自身が持っている `address_components` から導出する** ← これを採る

B にする理由:

  ・アプリ製の行は Google の `address_components` を**自分で持っている**。
    通貨判定が今まさに使っている一次情報なので、他所から推測するより正しい
  ・**seed が付かなかった行にも効く**（dev 実測 349 行）。A は catalog に
    載っている店にしか届かない
  ・「JSONB を掘るのをやめる」方針と矛盾しない。掘るのを 1 回に減らして
    列へ固定するのが、列を足した目的そのものである

## 何を country とみなすか

`address_components` の要素で `types` に 'country' を含むものの `shortText`。
ISO-3166-1 alpha-2（2 文字の大文字）でなければ採らない。Google は
`longText`（"日本"）しか返さないことがあるため、そこは埋めずに残す。

既定は数えるだけ。`--apply` を付けたときだけ commit する。
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

# address_components から country の shortText を取り出し、
# ISO-3166-1 alpha-2 として妥当なものだけを返す式。
COUNTRY_FROM_COMPONENTS = """
  (
    SELECT c ->> 'shortText'
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.address_components) = 'array'
           THEN r.address_components ELSE '[]'::jsonb END
    ) AS c
    WHERE c -> 'types' ? 'country'
      AND c ->> 'shortText' ~ '^[A-Z]{2}$'
    LIMIT 1
  )
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="アプリ製の行へ country_code を刻みます"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--apply", action="store_true", help="指定したときだけ commit する"
    )
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection: Any = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                  COUNT(*) FILTER (WHERE country_code IS NULL) AS missing,
                  COUNT(*) FILTER (
                    WHERE country_code IS NULL AND {COUNTRY_FROM_COMPONENTS} IS NOT NULL
                  ) AS fillable
                FROM restaurants r
                """
            )
            missing, fillable = cursor.fetchone()
            LOGGER.info("country_code が NULL の行 : %d", missing)
            LOGGER.info("  うち埋められる行        : %d", fillable)
            LOGGER.info("  埋められない行          : %d", missing - fillable)

            # ⚠️ 既に値がある行は触らない。**上書きではなく穴埋めである。**
            cursor.execute(
                f"""
                UPDATE restaurants r
                SET country_code = {COUNTRY_FROM_COMPONENTS}
                WHERE r.country_code IS NULL
                  AND {COUNTRY_FROM_COMPONENTS} IS NOT NULL
                """
            )
            updated = cursor.rowcount
            LOGGER.info("更新した行: %d", updated)
            if updated != fillable:
                raise RuntimeError(
                    f"更新件数({updated})が事前に数えた件数({fillable})と一致しません。"
                    "想定と違う行を掴んでいる可能性があるため中断します"
                )

            cursor.execute(
                """
                SELECT created_by_source,
                       COUNT(*) FILTER (WHERE country_code IS NOT NULL),
                       COUNT(*)
                FROM restaurants GROUP BY 1 ORDER BY 3 DESC
                """
            )
            LOGGER.info("最終状態:")
            for source, filled, total in cursor.fetchall():
                LOGGER.info("  %-10s %d / %d 行に country_code", source, filled, total)

        if args.apply:
            connection.commit()
            LOGGER.info("commit しました（%d 行）", updated)
        else:
            connection.rollback()
            LOGGER.info("--apply が無いので rollback しました（対象 %d 行）", updated)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
