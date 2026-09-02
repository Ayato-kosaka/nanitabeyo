#!/usr/bin/env python3
"""#1629 «引きの状態（ズームアウト）の検索» をゼロベースで作り直すために測る読み取り専用スクリプト。

## なぜ要るのか

「日本全体を映して『このエリアで再検索』を押すと必ず 0 件になる」（オーナー報告）。
真因は半径を 50km へ clamp していることだが、**clamp を外すと今度は
«全国の店舗を集計する» ことになる**ので、外してよいかどうかは数字を見ないと決められない。

決めたいのは次の 3 点である。

1. `restaurants` は全国で何件あるか（＝ clamp を外したときに WHERE が通す行数の上限）
2. **有効な入札（status='paid' かつ start_date <= today < end_date）を持つ店は何件か**
   ← 小さければ «全国からスポンサー優先で N 件» を入札テーブル駆動で安く作れる。設計の分岐点
3. 1 ユーザーあたりの «自分の記録» は何件か（p50 / p95 / 最大）
   ← 自分の記録の地図で «半径で絞る» 必要が本当にあるのかの判断材料

さらに `--explain` で、引き（日本全体 ≒ 半径 1,500km）における
**現行クエリ（before）と、入札駆動 + KNN の新クエリ（after）** を EXPLAIN ANALYZE で比べる。

## 読み取り専用である

SELECT と、SELECT に対する EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_wide_area_search.py --schema dev
    python scripts/db-checks/measure_wide_area_search.py --schema dev --explain

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

# 日本全体を映したときの地図の中心（`REGION_JP`。長野県あたり）と、その viewport の半径。
# app-expo/features/map/constants.ts の REGION_JP（delta 20 度前後）から
# regionToArea の «対角線の半分» を計算すると 1,500km 前後になる。
JP_LAT, JP_LNG = 36.2048, 138.2529
JP_RADIUS_M = 1_500_000
# 東京駅。寄りの比較用
TOKYO_LAT, TOKYO_LNG = 35.681236, 139.767125
LIMIT = 20

ORIGIN_JP = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"


def one(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return row[0] if row else None


def section(title):
    logger.info("")
    logger.info("=" * 72)
    logger.info("# %s", title)
    logger.info("=" * 72)


def run_counts(cur):
    section("1. 母数（clamp を外したときに何行が対象になるのか）")

    total = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total:,}")

    in_jp = one(
        cur,
        f"""
        SELECT count(*) FROM restaurants r
        WHERE ST_DWithin(r.location, {ORIGIN_JP}, %s)
        """,
        (JP_LNG, JP_LAT, JP_RADIUS_M),
    )
    logger.info(
        "うち «日本全体の viewport»（中心 %.4f,%.4f / 半径 %dkm）の中: %s",
        JP_LAT,
        JP_LNG,
        JP_RADIUS_M // 1000,
        f"{in_jp:,}",
    )

    in_50km = one(
        cur,
        f"""
        SELECT count(*) FROM restaurants r
        WHERE ST_DWithin(r.location, {ORIGIN_JP}, 50000)
        """,
        (JP_LNG, JP_LAT),
    )
    logger.info(
        "うち «現行の clamp 後»（同じ中心 / 半径 50km）の中: %s  ← ここが実際に検索されている範囲",
        f"{in_50km:,}",
    )

    tokyo_5km = one(
        cur,
        f"""
        SELECT count(*) FROM restaurants r
        WHERE ST_DWithin(r.location, {ORIGIN_JP}, 5000)
        """,
        (TOKYO_LNG, TOKYO_LAT),
    )
    logger.info("（参考）東京駅から 5km: %s", f"{tokyo_5km:,}")


def run_bids(cur):
    section("2. 有効な入札を持つ店の件数（«全国からスポンサー優先» が安いかどうか）")

    total_bids = one(cur, "SELECT count(*) FROM restaurant_bids")
    logger.info("restaurant_bids の総行数: %s", f"{total_bids:,}")

    by_status = []
    cur.execute(
        "SELECT status, count(*) FROM restaurant_bids GROUP BY status ORDER BY 2 DESC"
    )
    for status, count in cur.fetchall():
        by_status.append(f"{status}={count:,}")
    logger.info("status の内訳: %s", ", ".join(by_status) or "（0 行）")

    active_rows = one(
        cur,
        """
        SELECT count(*) FROM restaurant_bids
        WHERE status = 'paid' AND start_date <= CURRENT_DATE AND end_date > CURRENT_DATE
        """,
    )
    active_restaurants = one(
        cur,
        """
        SELECT count(DISTINCT restaurant_id) FROM restaurant_bids
        WHERE status = 'paid' AND start_date <= CURRENT_DATE AND end_date > CURRENT_DATE
        """,
    )
    logger.info("有効な入札の行数（paid かつ 期間内）: %s", f"{active_rows:,}")
    logger.info(
        "有効な入札を持つ店の件数: %s  ← これが小さいほど «全国スポンサー優先» は安い",
        f"{active_restaurants:,}",
    )

    logger.info("")
    logger.info(
        "restaurant_bids の索引（有効入札を «入札テーブル駆動» で引けるかの判断材料）:"
    )
    cur.execute(
        """
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'restaurant_bids' AND schemaname = current_schema()
        ORDER BY indexname
        """
    )
    rows = cur.fetchall()
    if not rows:
        logger.info("  （索引なし）")
    for name, definition in rows:
        logger.info("  %s: %s", name, definition)


def run_user_records(cur):
    section("3. 1 ユーザーあたりの «自分の記録» の分布（半径で絞る必要があるのか）")

    for label, sql in (
        (
            "食べた（dish_reviews。削除済みを除く）",
            """
            SELECT user_id, count(*)::int AS n
            FROM dish_reviews WHERE deleted_at IS NULL GROUP BY user_id
            """,
        ),
        (
            "食べたい（reactions の save / dish_media）",
            """
            SELECT user_id, count(*)::int AS n
            FROM reactions
            WHERE action_type = 'save' AND target_type = 'dish_media'
            GROUP BY user_id
            """,
        ),
    ):
        cur.execute(
            f"""
            WITH per_user AS ({sql})
            SELECT
              count(*)::int                                            AS users,
              COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY n), 0) AS p50,
              COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY n), 0) AS p95,
              COALESCE(max(n), 0)                                      AS max_n,
              COALESCE(sum(n), 0)                                      AS total
            FROM per_user
            """
        )
        users, p50, p95, max_n, total = cur.fetchone()
        logger.info(
            "%s: ユーザー数 %s / p50 %s / p95 %s / 最大 %s / 合計 %s",
            label,
            f"{users:,}",
            f"{p50:,}",
            f"{p95:,}",
            f"{max_n:,}",
            f"{total:,}",
        )

    # 「記録がどれくらい地理的に散っているか」= 自分の記録の地図で 50km clamp が
    # どれだけ取りこぼすか。記録数が最多のユーザーについて、記録の重心から
    # 50km 圏外にある店の割合を出す。
    logger.info("")
    heaviest = one(
        cur,
        """
        SELECT user_id FROM dish_reviews WHERE deleted_at IS NULL
        GROUP BY user_id ORDER BY count(*) DESC LIMIT 1
        """,
    )
    if heaviest is None:
        logger.info("dish_reviews を持つユーザーが居ないため、散らばりは測れない")
        return
    cur.execute(
        """
        WITH mine AS (
          SELECT DISTINCT r.id, r.location
          FROM dish_reviews dr
          JOIN dishes d ON d.id = dr.dish_id
          JOIN restaurants r ON r.id = d.restaurant_id
          WHERE dr.user_id = %s::uuid AND dr.deleted_at IS NULL
        ),
        center AS (SELECT ST_Centroid(ST_Collect(location::geometry)) AS g FROM mine)
        SELECT
          (SELECT count(*) FROM mine)::int,
          (SELECT count(*) FROM mine, center
             WHERE ST_DWithin(mine.location, center.g::geography, 50000))::int,
          (SELECT COALESCE(max(ST_Distance(mine.location, center.g::geography)), 0) FROM mine, center)
        """,
        (heaviest,),
    )
    n_all, n_in_50km, max_dist = cur.fetchone()
    logger.info(
        "記録が最多のユーザー（%s）: 店舗 %s 件 / 記録の重心から 50km 圏内 %s 件 / 最遠 %.0f km",
        heaviest,
        f"{n_all:,}",
        f"{n_in_50km:,}",
        (max_dist or 0) / 1000,
    )


# ---------------------------------------------------------------------------
# EXPLAIN 用のクエリ形
#
# ⚠️ api/src/v1/restaurants/restaurants.repository.ts の SQL を «同じ形» で写している。
#    repository を直したらこちらも直すこと。
# ---------------------------------------------------------------------------

# before: 現行（#1629 KNN 化後）。既定は入札額順で、nearby CTE に LIMIT が無い。
# 半径が全国規模になると «全国の restaurants × restaurant_bids» を集計することになる。
WIDE_BEFORE = f"""
WITH nearby AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, {ORIGIN_JP}, %s)
),
candidates AS (
  SELECT n.id,
         COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
         MAX(rb.end_date) AS max_end_date
  FROM nearby n
  LEFT JOIN restaurant_bids rb ON rb.restaurant_id = n.id
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
  GROUP BY n.id
  ORDER BY total_cents DESC
  LIMIT %s
)
SELECT r.id, c.total_cents, c.max_end_date,
       COUNT(dr.id)::int AS review_count,
       COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.total_cents, c.max_end_date
ORDER BY c.total_cents DESC
LIMIT %s
"""

# after: 入札テーブル駆動のスポンサー枠 + KNN の近傍枠。
# «半径内の全店を集計してから並べる» をやめ、候補を最初から limit 件に抑える。
WIDE_AFTER = f"""
WITH sponsored AS (
  SELECT rb.restaurant_id AS id,
         SUM(rb.amount_cents)::double precision AS total_cents,
         MAX(rb.end_date) AS max_end_date
  FROM restaurant_bids rb
  JOIN restaurants r ON r.id = rb.restaurant_id
  WHERE rb.status = 'paid'
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE
    AND ST_DWithin(r.location, {ORIGIN_JP}, %s)
  GROUP BY rb.restaurant_id
  ORDER BY total_cents DESC
  LIMIT %s
),
nearest AS (
  SELECT r.id
  FROM restaurants r
  WHERE ST_DWithin(r.location, {ORIGIN_JP}, %s)
    AND NOT EXISTS (SELECT 1 FROM sponsored s WHERE s.id = r.id)
  ORDER BY r.location <-> {ORIGIN_JP}
  LIMIT %s
),
candidates AS (
  SELECT id, total_cents, max_end_date, 0 AS tier FROM sponsored
  UNION ALL
  SELECT id, 0::double precision, NULL::date, 1 AS tier FROM nearest
)
SELECT r.id, c.total_cents, c.max_end_date,
       COUNT(dr.id)::int AS review_count,
       COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.tier, c.total_cents, c.max_end_date
ORDER BY c.tier ASC, c.total_cents DESC,
         ST_Distance(r.location, {ORIGIN_JP}) ASC
LIMIT %s
"""


def explain(cur, sql, params):
    cur.execute("EXPLAIN (ANALYZE, BUFFERS, TIMING) " + sql, params)
    plan = [row[0] for row in cur.fetchall()]
    exec_ms = None
    for line in plan:
        if line.strip().startswith("Execution Time:"):
            exec_ms = float(line.split(":")[1].strip().split(" ")[0])
    return plan, exec_ms


def log_plan(title, plan, exec_ms):
    logger.info("## %s", title)
    for line in plan:
        stripped = line.strip()
        if "Scan" in stripped or stripped.startswith("Execution Time"):
            logger.info("   %s", stripped)
    logger.info("")
    return exec_ms


def run_explain(cur):
    section("4. 引き（日本全体 ≒ 半径 1,500km）での所要時間 before / after")
    logger.info(
        "before = 現行（半径内の全店に入札を集計してから並べる） / "
        "after = 入札テーブル駆動のスポンサー枠 + KNN 近傍枠"
    )
    logger.info("")

    # 長時間クエリで CI を止めないための保険。EXPLAIN ANALYZE は実際に実行するので要る。
    cur.execute("SET LOCAL statement_timeout = '120s'")

    for label, radius in (("日本全体（1,500km）", JP_RADIUS_M), ("50km（現行 clamp）", 50_000)):
        try:
            plan, before_ms = explain(
                cur, WIDE_BEFORE, (JP_LNG, JP_LAT, radius, LIMIT, LIMIT)
            )
            log_plan(f"before / {label}", plan, before_ms)
        except psycopg2.errors.QueryCanceled:
            cur.connection.rollback()
            cur.execute(f'SET search_path TO "{SCHEMA[0]}", extensions')
            cur.execute("SET LOCAL statement_timeout = '120s'")
            before_ms = None
            logger.info("## before / %s", label)
            logger.info("   ⏱ 120 秒でタイムアウト（= 実用にならない）")
            logger.info("")

        plan, after_ms = explain(
            cur,
            WIDE_AFTER,
            (
                JP_LNG,
                JP_LAT,
                radius,
                LIMIT,
                JP_LNG,
                JP_LAT,
                radius,
                JP_LNG,
                JP_LAT,
                LIMIT,
                JP_LNG,
                JP_LAT,
                LIMIT,
            ),
        )
        log_plan(f"after / {label}", plan, after_ms)
        if before_ms and after_ms:
            logger.info(
                "   ⏱ %s: before %.1f ms → after %.1f ms（%.1f 倍）",
                label,
                before_ms,
                after_ms,
                before_ms / after_ms,
            )
            logger.info("")


# run_explain の中でタイムアウト後に search_path を貼り直すために使う
SCHEMA = ["dev"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--explain",
        action="store_true",
        help="引きでの before / after を EXPLAIN ANALYZE で比べる（重い）",
    )
    args = parser.parse_args()
    SCHEMA[0] = args.schema

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            user, database = one(cur, "SELECT current_user"), one(
                cur, "SELECT current_database()"
            )
            logger.info(
                "接続先: user=%s db=%s schema=%s", user, database, args.schema
            )

            run_counts(cur)
            run_bids(cur)
            run_user_records(cur)
            if args.explain:
                run_explain(cur)

    return 0


if __name__ == "__main__":
    sys.exit(main())
