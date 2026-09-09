#!/usr/bin/env python3
"""#1779 で落とす 4 列に、**いま何が入っているか**を測る（読み取り専用）。

## なぜ要るか

オーナーは «使われないのなら消して» と決めた。列を落とす migration を承認してもらう前に、
「消したら何を失うのか」を数字で出す。#1779 の migration 提案へそのまま貼るための材料である。

CLAUDE.md「承認を求めるときは、判断に必要な材料を全部その場に置く」の
«失敗したらどうなるか / データは消えるか» に当たる。

## 測る 4 列

| 列 | なぜ落とせるのか |
| --- | --- |
| `dishes.name` | 表示名はカテゴリのローカライズ表記から引く（PR #1901 で読み手 0、#1903 で書き手 0） |
| `restaurants.image_url` | 店の画像は `image_path` 由来の `imageUrls` から取る（#1680 / #1902） |
| `restaurants.plus_code` | 読み手が 1 つも無い（#1780 で新規保存も停止済み） |
| `dishes.data_origin` | 読み手が 1 つも無い。**ただし dev の 94.6% が `restaurant_recommendation`** なので、`synced_at` で同じ区別が付くことを併せて測る |

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_drop_candidate_columns.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
    concurrency_group_suffix: readonly-audit

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import json
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

DISHES_SQL = """
  SELECT
    count(*)                                                    AS dishes_total,
    count(*) FILTER (WHERE name IS NOT NULL AND name <> '')     AS with_name,
    count(*) FILTER (WHERE data_origin = 'user_or_google')      AS origin_user_or_google,
    count(*) FILTER (WHERE data_origin = 'restaurant_recommendation')
                                                                AS origin_recommendation
  FROM dishes
"""

# data_origin を落としても «パイプライン製かどうか» が分かるか。
# `synced_at IS NOT NULL` と 1 対 1 なら、data_origin は完全に冗長である。
DATA_ORIGIN_REDUNDANCY_SQL = """
  SELECT
    count(*) FILTER (
      WHERE data_origin = 'restaurant_recommendation' AND synced_at IS NULL
    ) AS reco_without_synced_at,
    count(*) FILTER (
      WHERE data_origin = 'user_or_google' AND synced_at IS NOT NULL
    ) AS user_with_synced_at,
    min(created_at) FILTER (WHERE data_origin = 'restaurant_recommendation')
      AS reco_first_created_at,
    max(created_at) FILTER (WHERE data_origin = 'restaurant_recommendation')
      AS reco_last_created_at
  FROM dishes
"""

RESTAURANTS_SQL = """
  SELECT
    count(*)                                                          AS restaurants_total,
    count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '') AS with_image_url,
    count(*) FILTER (
      WHERE image_url LIKE '%googleusercontent%'
         OR image_url LIKE '%maps.googleapis.com%'
    )                                                                 AS image_url_google,
    count(*) FILTER (
      WHERE image_url IS NOT NULL AND image_url <> ''
        AND (image_path IS NULL OR image_path = '')
    )                                                                 AS image_url_without_image_path,
    count(*) FILTER (WHERE plus_code IS NOT NULL)                     AS with_plus_code
  FROM restaurants
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

            cur.execute(DISHES_SQL)
            dishes_total, with_name, origin_user, origin_reco = cur.fetchone()

            cur.execute(DATA_ORIGIN_REDUNDANCY_SQL)
            (
                reco_without_synced_at,
                user_with_synced_at,
                reco_first_created_at,
                reco_last_created_at,
            ) = cur.fetchone()

            cur.execute(RESTAURANTS_SQL)
            (
                restaurants_total,
                with_image_url,
                image_url_google,
                image_url_orphan,
                with_plus_code,
            ) = cur.fetchone()

    def pct(n: int, total: int) -> str:
        return f"{100.0 * n / total:.2f}%" if total else "n/a"

    logger.info("")
    logger.info("=" * 72)
    logger.info("# #1779 落とす 4 列に、いま何が入っているか（schema=%s）", args.schema)
    logger.info("=" * 72)
    logger.info("dishes 総数      : %12s", f"{dishes_total:,}")
    logger.info("restaurants 総数 : %12s", f"{restaurants_total:,}")
    logger.info("")
    logger.info("## dishes.name — 消すと «その店でのその料理の呼び名» を失う")
    logger.info("  非空          : %12s (%s)", f"{with_name:,}", pct(with_name, dishes_total))
    logger.info("")
    logger.info("## dishes.data_origin — 消すと «BigQuery 生成かどうか» を失う")
    logger.info("  user_or_google           : %12s", f"{origin_user:,}")
    logger.info("  restaurant_recommendation: %12s", f"{origin_reco:,}")
    logger.info(
        "  ⚠️ synced_at で代替できるか — 食い違い: reco なのに synced_at が NULL=%s / "
        "user なのに synced_at が非 NULL=%s（両方 0 なら data_origin は完全に冗長）",
        f"{reco_without_synced_at:,}",
        f"{user_with_synced_at:,}",
    )
    logger.info(
        "  reco 行の created_at: %s 〜 %s", reco_first_created_at, reco_last_created_at
    )
    logger.info("")
    logger.info("## restaurants.image_url — 消すと Google 由来の写真 URI を失う")
    logger.info("  非空                     : %12s (%s)", f"{with_image_url:,}", pct(with_image_url, restaurants_total))
    logger.info("  うち Google 由来         : %12s  ← ToS 3.2.3 により保持できない", f"{image_url_google:,}")
    logger.info(
        "  うち image_path が無い   : %12s  ← imageUrls が組み立たない行",
        f"{image_url_orphan:,}",
    )
    logger.info("")
    logger.info("## restaurants.plus_code — 消すと Open Location Code を失う")
    logger.info("  非 NULL       : %12s (%s)", f"{with_plus_code:,}", pct(with_plus_code, restaurants_total))

    result = {
        "schema": args.schema,
        "dishes_total": dishes_total,
        "dishes_with_name": with_name,
        "dishes_data_origin_user_or_google": origin_user,
        "dishes_data_origin_restaurant_recommendation": origin_reco,
        "dishes_reco_without_synced_at": reco_without_synced_at,
        "dishes_user_with_synced_at": user_with_synced_at,
        "dishes_reco_first_created_at": str(reco_first_created_at),
        "dishes_reco_last_created_at": str(reco_last_created_at),
        "restaurants_total": restaurants_total,
        "restaurants_with_image_url": with_image_url,
        "restaurants_image_url_google": image_url_google,
        "restaurants_image_url_without_image_path": image_url_orphan,
        "restaurants_with_plus_code": with_plus_code,
    }
    logger.info("")
    logger.info("=" * 72)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 72)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
