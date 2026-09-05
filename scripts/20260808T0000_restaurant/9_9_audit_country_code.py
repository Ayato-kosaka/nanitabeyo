#!/usr/bin/env python3
"""`country_code` 列を足したとき、既存 57 万行を本当に全部埋められるかを数える。

## なぜ必要か

オーナーからの問い（2026-08-28）:
「country_code は必須カラムですよね？ミスらない保証は？既存のレストランも全部埋まる？」

**埋まらない行が 1 行でもあれば NOT NULL にはできない。** 推測ではなく数えて答える。

## 埋める根拠は行の出所で違う

| 行の種類 | 根拠 | 確からしさ |
|---|---|---|
| パイプライン製 | 取り込み時の国（`1_3_load_overture.py` の `addresses[1].country`） | 出所のある値 |
| アプリ製 | `address_components` の `country.shortText` | 値があれば確実 |

⚠️ #843 かつてここは «日本の座標矩形で絞っているので構造的に JP» と書いていたが、
**矩形（緯度20.0–46.5 / 経度122.0–154.0）は韓国全土とロシア沿海地方を含む**。
run=restaurant-2026-08-23 の catalog 620,428 行のうち 97,726 行が韓国の店で、
それでも全行 `country_code='JP'` になっていた。下の «矩形の外にある行» の数え方は
その事故を検出できないので、判定の根拠としては使えない（残してあるのは座標破損の保険）。

アプリ製は海外の店もありうる（ユーザーが旅行先で登録する）ので、
**一律 'JP' で埋めてはいけない**。ここを 1 行ずつ数える。

## 何をしないか

**1行も書き換えない。** SELECT だけ。
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

# address_components から country の shortText を取り出す。
# jsonb の NOT NULL は配列であることを保証しないので、型を確かめてから展開する。
COUNTRY_EXPR = """
  (SELECT elem->>'shortText'
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(address_components) = 'array'
            THEN address_components ELSE '[]'::jsonb END) AS elem
    WHERE elem->'types' ? 'country'
    LIMIT 1)
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="country_code を全行埋められるかを数えます（読み取り専用）"
    )
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
                f"""
                SELECT
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE created_by_source = 'pipeline') AS pipeline_rows,
                  COUNT(*) FILTER (WHERE created_by_source <> 'pipeline') AS app_rows,
                  COUNT(*) FILTER (
                    WHERE created_by_source <> 'pipeline' AND {COUNTRY_EXPR} IS NOT NULL
                  ) AS app_rows_resolvable,
                  COUNT(*) FILTER (
                    WHERE created_by_source <> 'pipeline' AND {COUNTRY_EXPR} IS NULL
                  ) AS app_rows_unresolvable
                FROM restaurants
                """
            )
            total, pipeline_rows, app_rows, ok, ng = cursor.fetchone()
            LOGGER.info("restaurants 総数: %d行", total)
            LOGGER.info(
                "  パイプライン製: %d行 → 取り込み時の country（1_3）を運んだ値", pipeline_rows
            )
            LOGGER.info("  アプリ製      : %d行", app_rows)
            LOGGER.info("    国が引ける  : %d行", ok)
            LOGGER.info("    国が引けない: %d行  ← ここが 0 でないと NOT NULL にできない", ng)

            # アプリ製の国の内訳。'JP' 以外があるなら «一律 JP» は誤りだと分かる。
            cursor.execute(
                f"""
                SELECT {COUNTRY_EXPR} AS cc, COUNT(*)
                FROM restaurants
                WHERE created_by_source <> 'pipeline'
                GROUP BY 1 ORDER BY 2 DESC LIMIT 20
                """
            )
            LOGGER.info("アプリ製の国の内訳:")
            for cc, count in cursor.fetchall():
                LOGGER.info("  %-6s %d行", cc if cc else "(引けない)", count)

            # 形式が ISO-3166-1 alpha-2 になっているか（CHECK 制約を張れるか）
            cursor.execute(
                f"""
                SELECT COUNT(*) FROM restaurants
                WHERE created_by_source <> 'pipeline'
                  AND {COUNTRY_EXPR} IS NOT NULL
                  AND {COUNTRY_EXPR} !~ '^[A-Z]{{2}}$'
                """
            )
            LOGGER.info(
                "2文字の大文字になっていない値: %d行  ← CHECK 制約を張れるかの判定",
                cursor.fetchone()[0],
            )

            # パイプライン製が本当に日本の矩形に収まっているか（JP と断言してよいか）
            cursor.execute(
                """
                SELECT COUNT(*) FROM restaurants
                WHERE created_by_source = 'pipeline'
                  AND NOT (latitude BETWEEN 20 AND 46 AND longitude BETWEEN 122 AND 154)
                """
            )
            LOGGER.info(
                "パイプライン製で日本の矩形の外にある行: %d行  ← 座標破損の保険"
                "（#843: 矩形の «中» は韓国を含むので、これが 0 でも JP の根拠にならない）",
                cursor.fetchone()[0],
            )
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
