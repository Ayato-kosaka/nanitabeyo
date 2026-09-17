#!/usr/bin/env python3
"""#1666 dev で «営業時間を持っている店» を 1 つ選ぶ（読み取り専用）。

## なぜ要るか

店舗詳細の営業時間欄（[PR #1935](https://github.com/Ayato-kosaka/nanitabeyo/pull/1935)）の
**ネイティブのスクリーンショット**を撮るには、実データを持つ店の id が要る。

⚠️ **Detox には API をモックする仕組みが無い**（`e2e-mobile/tests/my-dishes/restaurant-routes.test.ts`
の冒頭に書いてある）。だからネイティブのカタログ撮影は **dev の実データ**を使う。
`confirm-restaurant-1671.test.ts` が同じやり方で «dev に居ることを確認済みの place_id» を
埋め込んでおり、これはその営業時間版である。

## 何を選ぶのか

**絵として意味のある店**を選ぶ。具体的には

1. 曜日が 2 つ以上ある（1 曜日だけだと «定休» ばかりの絵になる）
2. できれば **1 日に 2 コマ以上**ある（昼・夜の 2 段が出る絵）
3. できれば **日またぎ**（`crosses_midnight`）を含む（«翌» の表示が出る絵）

上から順に条件を緩めて探す。**見つからなければ «見つからなかった» と出して終わる**
（条件を勝手に落として «それらしい店» を返さない）。

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

実行:
    python3 scripts/20260808T0000_restaurant/9_9_find_restaurant_with_hours.py --schema dev
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

# 候補。上ほど «絵として良い»。
#
# ⚠️ **`ORDER BY` を決定的にすること。** run のたびに違う店が出ると、
#    撮った絵とテストに埋めた id が食い違う。id 昇順で固定する。
CANDIDATE_SQL = """
  WITH per_restaurant AS (
    SELECT
        h.restaurant_id,
        COUNT(DISTINCT h.day_of_week)                             AS day_count,
        COUNT(*)                                                  AS row_count,
        MAX(CASE WHEN h.crosses_midnight THEN 1 ELSE 0 END)       AS has_crossing,
        MAX(per_day.slots)                                        AS max_slots_in_a_day,
        COUNT(DISTINCT h.source)                                  AS source_count
    FROM restaurant_opening_hours h
    JOIN LATERAL (
      SELECT COUNT(*) AS slots
      FROM restaurant_opening_hours d
      WHERE d.restaurant_id = h.restaurant_id AND d.day_of_week = h.day_of_week
    ) per_day ON TRUE
    GROUP BY h.restaurant_id
  )
  SELECT
      r.id::text, r.name, r.google_place_id, r.country_code,
      p.day_count, p.row_count, p.has_crossing, p.max_slots_in_a_day, p.source_count
  FROM per_restaurant p
  JOIN restaurants r ON r.id = p.restaurant_id
  WHERE p.day_count >= %s
    AND p.max_slots_in_a_day >= %s
    AND p.has_crossing >= %s
  ORDER BY r.id
  LIMIT 5
"""

WEEK_SQL = """
  SELECT day_of_week, source, opens_at, closes_at, crosses_midnight, fetched_at
  FROM restaurant_opening_hours
  WHERE restaurant_id = %s
  ORDER BY day_of_week, opens_at
"""

TOTALS_SQL = """
  SELECT COUNT(DISTINCT restaurant_id) AS restaurants, COUNT(*) AS rows, source
  FROM restaurant_opening_hours
  GROUP BY source
  ORDER BY 1 DESC
"""

# 上から順に緩める（day_count, max_slots_in_a_day, has_crossing）
CONDITIONS = [
    (2, 2, 1),  # 曜日 2 つ以上 / 1 日 2 コマ以上 / 日またぎあり
    (2, 2, 0),  # 日またぎは諦める
    (2, 1, 0),  # 1 日 1 コマでよい
    (1, 1, 0),  # 最後の砦
]

DOW_LABEL = ["日", "月", "火", "水", "木", "金", "土"]


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    args = parser.parse_args()

    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = on")

            cursor.execute(TOTALS_SQL)
            LOGGER.info("restaurant_opening_hours の内訳（source 別）")
            for restaurants, rows, source in cursor.fetchall():
                LOGGER.info("  %-16s %7d 店 / %7d 行", source, restaurants, rows)

            for day_count, slots, crossing in CONDITIONS:
                cursor.execute(CANDIDATE_SQL, (day_count, slots, crossing))
                candidates = cursor.fetchall()
                LOGGER.info(
                    "条件（曜日>=%d / 1日のコマ>=%d / 日またぎ>=%d）: %d 件",
                    day_count, slots, crossing, len(candidates),
                )
                if candidates:
                    break
            else:
                LOGGER.error("営業時間を持つ店が 1 つも見つかりませんでした")
                return 1

            for rid, name, place_id, country, days, rows, crossing, slots, sources in candidates:
                LOGGER.info("")
                LOGGER.info("id             : %s", rid)
                LOGGER.info("name           : %s", name)
                LOGGER.info("google_place_id: %s", place_id)
                LOGGER.info("country_code   : %s", country)
                LOGGER.info(
                    "曜日 %d / 行 %d / 日またぎ %s / 1日の最大コマ %d / source %d 種",
                    days, rows, "あり" if crossing else "なし", slots, sources,
                )

            best = candidates[0][0]
            LOGGER.info("")
            LOGGER.info("=== 先頭の店の 1 週間（そのまま画面に出るもの） ===")
            cursor.execute(WEEK_SQL, (best,))
            for dow, source, opens_at, closes_at, crosses, fetched_at in cursor.fetchall():
                LOGGER.info(
                    "  %s  %s-%s%s  (%s / %s)",
                    DOW_LABEL[dow], opens_at, closes_at,
                    " 翌" if crosses else "", source, fetched_at,
                )
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
