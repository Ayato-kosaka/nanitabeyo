#!/usr/bin/env python3
"""#1667 «平均評価を出せる店» が何割あるかを測る（読み取り専用）。

## なぜ要るか

#1667 の完了条件に「coverage が計測され、#843 に反映されている」がある。
オーナー確定（2026-09-03）で **レビュー 0 件の店は評価まわりを何も出さない**と決まったので、
«評価を出せる店» = **非削除の `dish_reviews` を 1 件以上持つ店**である。

## ⚠️ 判定の出どころ

画面の出し分けは `meta.reviewCount > 0`（`SelectedRestaurantDetails.tsx`）で、
`reviewCount` は `RestaurantsRepository.getRestaurantReviewStats` が数えている:

    tx.dish_reviews.aggregate({
      where: { dishes: { restaurant_id }, deleted_at: null },
      _count: { _all: true }, _avg: { rating: true },
    })

**この SQL はその 2 条件を写し取ったものである。**（Prisma の集計を SQL へ持ち込む以上、
写経を避けられない。）`getRestaurantReviewStats` の `where` が変わったら、
**ここも直すこと**。数字だけが古い定義のまま出続けるのがいちばん危ない。

条件は 2 つだけ:
  1. `dish_reviews` → `dishes.restaurant_id` で店へ辿る
  2. `deleted_at IS NULL`（#1513 削除済みを件数・平均へ混ぜない）

## ⚠️ dev だけを見る

本番の DB はオーナーの指示があるまで触らない。`--schema` は `dev` のみ受ける。

実行:
    python3 scripts/db-checks/measure_rating_coverage.py --schema dev
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "20260808T0000_restaurant"))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 「評価を出せる店」の数え上げ。上の注記のとおり getRestaurantReviewStats の 2 条件を写している
COVERAGE_SQL = """
  WITH rated AS (
    SELECT DISTINCT d.restaurant_id
    FROM dish_reviews r
    JOIN dishes d ON d.id = r.dish_id
    WHERE r.deleted_at IS NULL
  )
  SELECT
      (SELECT COUNT(*) FROM restaurants)                              AS restaurants,
      (SELECT COUNT(*) FROM rated)                                    AS rated_restaurants,
      (SELECT COUNT(*) FROM dish_reviews WHERE deleted_at IS NULL)    AS live_reviews,
      (SELECT COUNT(*) FROM dish_reviews WHERE deleted_at IS NOT NULL) AS deleted_reviews
"""

# 「何件のレビューを持っているか」の分布。1 件だけの店が多いなら平均は当てにならない
DISTRIBUTION_SQL = """
  WITH per_restaurant AS (
    SELECT d.restaurant_id, COUNT(*) AS reviews
    FROM dish_reviews r
    JOIN dishes d ON d.id = r.dish_id
    WHERE r.deleted_at IS NULL
    GROUP BY d.restaurant_id
  )
  SELECT
      CASE
        WHEN reviews = 1 THEN '1 件'
        WHEN reviews BETWEEN 2 AND 4 THEN '2-4 件'
        WHEN reviews BETWEEN 5 AND 9 THEN '5-9 件'
        ELSE '10 件以上'
      END AS bucket,
      COUNT(*) AS restaurants
  FROM per_restaurant
  GROUP BY 1
  ORDER BY MIN(reviews)
"""

# rating の値域。#1667 のタスク「`0.0` を «低評価» と誤解させない UI にする」の前提として、
# **0 が実データに存在するのか**を見る。
# ⚠️ `rating` は `Int NOT NULL`（schema.prisma）なので «NULL があるか» は数えない。
#    数えても必ず 0 になる問い＝答えの決まっている検査は置かない。
RATING_RANGE_SQL = """
  SELECT MIN(rating), MAX(rating), COUNT(*) FILTER (WHERE rating = 0)
  FROM dish_reviews WHERE deleted_at IS NULL
"""


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    args = parser.parse_args()

    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = on")

            cursor.execute(COVERAGE_SQL)
            restaurants, rated, live, deleted = cursor.fetchone()
            pct = (rated / restaurants * 100) if restaurants else 0.0
            LOGGER.info("===== #1667 «平均評価を出せる店» の coverage（%s）=====", args.schema)
            LOGGER.info("店舗                       : %8d", restaurants)
            LOGGER.info("うち評価を出せる店         : %8d  (%.4f%%)", rated, pct)
            LOGGER.info("生きているレビュー         : %8d", live)
            LOGGER.info("削除済みレビュー（除外）   : %8d", deleted)

            cursor.execute(RATING_RANGE_SQL)
            lo, hi, zeros = cursor.fetchone()
            LOGGER.info("rating の値域              : %s 〜 %s", lo, hi)
            LOGGER.info("  うち rating = 0          : %8d 件", zeros)
            if zeros:
                LOGGER.warning(
                    "⚠️ rating = 0 が実データにある。«0.0» を «低評価» と読ませない表示になっているか確認すること（#1667）"
                )

            LOGGER.info("")
            LOGGER.info("評価を出せる店の «持っているレビュー数» の分布")
            cursor.execute(DISTRIBUTION_SQL)
            for bucket, count in cursor.fetchall():
                LOGGER.info("  %-10s %8d 店", bucket, count)
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
