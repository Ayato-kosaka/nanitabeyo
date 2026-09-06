#!/usr/bin/env python3
"""#1666 営業時間の行が «検索の候補集合に本当に当たっているか» を確かめる（読み取り専用）。

## なぜ要るか

`explain_opening_status.py --assert` は 2026-09-06 に ✅ を出したが、その中身は
**すべての地点・すべての半径で `restaurant_opening_hours から延べ 0 行`** だった
（[run 34036690111](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34036690111)）。

dev には OSM 由来 100,309 行（13,065 店）と公式サイト由来 1,456 行（150 店）が入っている。
候補集合 1,000 件のうち 1 店も当たらないのは、東京 20km でも起きるとは考えにくい。

> **「軽いから 0 行」なのか「当たらないから 0 行」なのかを、番人は区別していない。**

これは #1898 で直したはずの «測っていないのに緑» と同じ形である。
0 行の理由を切り分けるまで、あの ✅ を «閉じている» の根拠にしてはいけない。

## 出すもの

1. `restaurant_opening_hours` の総行数と、`source` 別・`day_of_week` 別の分布
2. 営業時間を持つ店が **東京駅から近い順 1,000 件**の中に何店あるか
   （＝ 番人が測っている候補集合と同じ切り口）
3. 同じことを 50km / 全国でも見る

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。
"""

from __future__ import annotations

import argparse
import json
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 番人が使う候補集合の大きさ（explain_opening_status.KNN_LIMIT と同じ考え方）
KNN_LIMIT = 1000

TOTALS_SQL = """
  SELECT source, count(*) AS rows, count(DISTINCT restaurant_id) AS restaurants
  FROM restaurant_opening_hours
  GROUP BY source
  ORDER BY 2 DESC
"""

DOW_SQL = """
  SELECT day_of_week, count(*) AS rows
  FROM restaurant_opening_hours
  GROUP BY day_of_week
  ORDER BY day_of_week
"""

# 東京駅から近い順 KNN_LIMIT 件のうち、営業時間を持つ店が何店あるか。
# ⚠️ 番人と同じ «KNN で候補を絞ってから» の形にする。半径で絞ると別のものを測る。
REACH_SQL = f"""
  WITH candidates AS (
    SELECT r.id
    FROM restaurants r
    ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
    LIMIT {KNN_LIMIT}
  )
  SELECT
    count(*) AS candidates,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh WHERE roh.restaurant_id = c.id
    )) AS with_any_hours,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh
      WHERE roh.restaurant_id = c.id AND roh.day_of_week = %s
    )) AS with_hours_today
  FROM candidates c
"""

POINTS = (
    ("東京駅", 139.7671, 35.6812),
    ("大阪駅", 135.4959, 34.7024),
    ("札幌駅", 141.3507, 43.0686),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import datetime

    import psycopg2

    # 番人と同じ «今日» の出し方（0 = 日曜 … 6 = 土曜）
    dow_today = datetime.date.today().isoweekday() % 7

    result = {"schema": args.schema, "dow_today": dow_today}

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)
            logger.info("今日の day_of_week（0=日曜）: %s", dow_today)

            cur.execute(TOTALS_SQL)
            totals = cur.fetchall()

            cur.execute(DOW_SQL)
            dows = cur.fetchall()

            reach = []
            for label, lng, lat in POINTS:
                cur.execute(REACH_SQL, (lng, lat, dow_today))
                reach.append((label, *cur.fetchone()))

    logger.info("")
    logger.info("=" * 78)
    logger.info("# #1666 営業時間の行は、検索の候補集合に当たっているか")
    logger.info("=" * 78)

    logger.info("")
    logger.info("## restaurant_opening_hours（source 別）")
    result["by_source"] = {}
    for source, rows, restaurants in totals:
        logger.info("  %-16s : %10s 行 / %8s 店", source, f"{rows:,}", f"{restaurants:,}")
        result["by_source"][source] = {"rows": rows, "restaurants": restaurants}

    logger.info("")
    logger.info("## day_of_week 別（0=日曜 … 6=土曜）")
    result["by_dow"] = {}
    for dow, rows in dows:
        mark = "  ← 今日" if dow == dow_today else ""
        logger.info("  %s : %10s 行%s", dow, f"{rows:,}", mark)
        result["by_dow"][str(dow)] = rows

    logger.info("")
    logger.info("## 近い順 %s 件のうち、営業時間を持つ店", f"{KNN_LIMIT:,}")
    logger.info("   ⚠️ ここが 0 なら、番人の «0 行 ✅» は «当たっていないから 0» である")
    result["reach"] = {}
    for label, candidates, with_any, with_today in reach:
        logger.info(
            "  %-8s : 候補 %s 件 / 営業時間あり %s 店 / 今日の曜日の行あり %s 店",
            label,
            f"{candidates:,}",
            f"{with_any:,}",
            f"{with_today:,}",
        )
        result["reach"][label] = {
            "candidates": candidates,
            "with_any_hours": with_any,
            "with_hours_today": with_today,
        }

    logger.info("")
    logger.info("=" * 78)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 78)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
