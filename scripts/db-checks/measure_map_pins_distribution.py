#!/usr/bin/env python3
"""#1629 map-pins の上限 300 が実際にどれくらい発動するかを測る読み取り専用スクリプト。

## なぜ要るのか

これまでの実測は «1 ユーザーあたりの dish_reviews 件数»（p50 11 / p95 9,947）だが、
Map のピンは **店舗単位に畳んだあと** の数に上限が掛かる。
「300 で切られるユーザーが何人いるか」「その人たちの店舗が地理的にどれだけ散っているか」は
店舗単位で数え直さないと分からない。#1629 で選び方を
最新順 → 格子 round-robin（分布保存）へ変えた判断の裏取りに使う。

出すもの:

1. 1 ユーザーあたりの **ピン数（= 記録のある店舗数、削除済みレビュー除外）** の分布
   （p50 / p90 / p95 / max と、300 を超えるユーザー数）
2. 300 を超える各ユーザーについて、店舗が占める 0.5 度格子セルの数
   （= 引きの絵で立つべき地域の数。300 より小さければ格子 round-robin で全地域に代表が立つ）

## 読み取り専用である

SELECT しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_map_pins_distribution.py --schema dev

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import sys

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

LIMIT = 300  # MY_DISH_MAP_PINS_LIMIT
CELL_DEG = 0.5  # MY_DISH_MAP_PINS_DEFAULT_CELL_DEG

# 1 ユーザーあたりの «記録のある店舗数»（eaten 側のみ。want は最大 27 件で上限に効かない）
PIN_COUNT_SQL = """
WITH per_user AS (
  SELECT dr.user_id, COUNT(DISTINCT d.restaurant_id) AS pin_count
  FROM dish_reviews dr
  JOIN dishes d ON d.id = dr.dish_id
  WHERE dr.deleted_at IS NULL
  GROUP BY dr.user_id
)
SELECT
  COUNT(*)                                                        AS users,
  percentile_disc(0.5)  WITHIN GROUP (ORDER BY pin_count)         AS p50,
  percentile_disc(0.9)  WITHIN GROUP (ORDER BY pin_count)         AS p90,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY pin_count)         AS p95,
  MAX(pin_count)                                                  AS max,
  COUNT(*) FILTER (WHERE pin_count > %(limit)s)                   AS over_limit_users
FROM per_user
"""

# 上限を超えるユーザーごとの、店舗が占める 0.5 度格子セル数
OVER_LIMIT_CELLS_SQL = """
WITH per_user AS (
  SELECT dr.user_id, d.restaurant_id
  FROM dish_reviews dr
  JOIN dishes d ON d.id = dr.dish_id
  WHERE dr.deleted_at IS NULL
  GROUP BY dr.user_id, d.restaurant_id
),
counted AS (
  SELECT user_id, COUNT(*) AS pin_count
  FROM per_user
  GROUP BY user_id
  HAVING COUNT(*) > %(limit)s
)
SELECT
  c.user_id,
  c.pin_count,
  COUNT(DISTINCT (FLOOR(r.latitude / %(cell)s), FLOOR(r.longitude / %(cell)s))) AS occupied_cells
FROM counted c
JOIN per_user pu ON pu.user_id = c.user_id
JOIN restaurants r ON r.id = pu.restaurant_id
GROUP BY c.user_id, c.pin_count
ORDER BY c.pin_count DESC
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", help="対象スキーマ（既定: dev）")
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        logger.error("DATABASE_URL が未設定")
        return 1

    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO %s", (args.schema,))

            cur.execute(PIN_COUNT_SQL, {"limit": LIMIT})
            users, p50, p90, p95, mx, over = cur.fetchone()
            logger.info("== 1 ユーザーあたりのピン数（記録のある店舗数） ==")
            logger.info(
                "users=%s p50=%s p90=%s p95=%s max=%s / %s 件超え=%s 人",
                users, p50, p90, p95, mx, LIMIT, over,
            )

            cur.execute(OVER_LIMIT_CELLS_SQL, {"limit": LIMIT, "cell": CELL_DEG})
            rows = cur.fetchall()
            logger.info("== %s 件超えユーザーの 0.5 度格子セル占有数 ==", LIMIT)
            if not rows:
                logger.info("該当ユーザーなし（現状は truncated が発動しない）")
            for user_id, pin_count, cells in rows:
                verdict = "全地域に代表が立つ" if cells <= LIMIT else f"セル数が上限超（{cells} > {LIMIT}）"
                logger.info("user=%s pins=%s cells=%s → %s", user_id, pin_count, cells, verdict)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
