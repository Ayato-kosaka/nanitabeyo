#!/usr/bin/env python3
"""近傍検索と店名検索が索引に乗っているかを EXPLAIN ANALYZE で測る読み取り専用スクリプト。

## なぜ要るのか

#1629 の 14 / 15 / 16（「このエリアで再検索が遅い」「保存したお店の取得に失敗しました」
「店名検索が遅い」）に対して、次の 2 つを入れた。

1. `api/src/v1/restaurants/restaurants.repository.ts` を bbox + acos から
   `ST_DWithin` / `ST_Distance` へ（#1634）
2. dev に無かった `idx_restaurants_location`（GIST）を揃え直した（#1638）

**入れたことと、効いていることは別である。** 索引があってもプランナが選ばなければ
Seq Scan のままになる。ここで測るのは «実行計画に索引が現れるか» と «実測の所要時間» の 2 つ。

⚠️ ここに書いてある SQL は repository のクエリそのものではなく、**同じ述語だけを取り出した
最小形**である。repository は他の JOIN や集計を伴うので、ここの数字は «索引に乗るかどうか»
の判定にだけ使うこと。画面全体の所要時間は BigQuery のリクエストログで見る。

## 読み取り専用である

SELECT に対する EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_restaurants_nearby.py --schema dev

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

# 東京駅。#1629 のログに出ていた実際の検索地点に近い
LAT, LNG = 35.681236, 139.767125

NEARBY_SQL = """
SELECT r.id FROM restaurants r
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) ASC
LIMIT 100
"""

CASES = [
    ("近傍 500m（このエリアで再検索の実用域）", NEARBY_SQL, (LNG, LAT, 500, LNG, LAT)),
    ("近傍 5km", NEARBY_SQL, (LNG, LAT, 5000, LNG, LAT)),
    (
        "近傍 50km（DTO の上限。以前は日本地図から 1,000km が飛んでいた）",
        NEARBY_SQL,
        (LNG, LAT, 50000, LNG, LAT),
    ),
    (
        "店名の中間一致（一蘭）",
        "SELECT r.id FROM restaurants r WHERE r.name ILIKE %s LIMIT 100",
        ("%一蘭%",),
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, database = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, database, args.schema)

            cur.execute("SELECT count(*) FROM restaurants")
            logger.info("restaurants の行数: %s", f"{cur.fetchone()[0]:,}")
            logger.info("")

            for title, sql, params in CASES:
                cur.execute("EXPLAIN (ANALYZE, BUFFERS, TIMING) " + sql, params)
                plan = [row[0] for row in cur.fetchall()]

                logger.info("## %s", title)
                for line in plan:
                    if "Scan" in line or line.startswith("Execution Time"):
                        logger.info("   %s", line.strip())
                # 索引が選ばれたかを機械で判定する（«それらしい出力» で終わらせない）
                if any("Seq Scan on restaurants" in line for line in plan):
                    logger.info("   ⚠️ Seq Scan（索引が選ばれていない）")
                else:
                    logger.info("   ✅ 索引が選ばれている")
                logger.info("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
