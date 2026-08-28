#!/usr/bin/env python3
"""#1629 店舗検索の並びを «入札額順» から «投稿が多い順» へ変えたときの所要時間を測る読み取り専用スクリプト。

## なぜ要るのか

オーナー指示「入札順にしなくて良いです。一旦投稿が多い順とかが良いかな？」に沿って、
`api/src/v1/restaurants/restaurants.repository.ts` の既定の並びを
**«投稿（dish_media。削除済みを除く）が多い順 → 同数なら中心から近い順»** に変えた。

危険なのは性能である。«半径内の restaurants を全部集計してから並べる» 形に戻すと、
日本全体（半径 1,500km）では 57 万件の集計になり 9.7 秒級へ逆戻りする
（`measure_wide_area_search.py` の実測）。**«絞る → 集計する» の順序を壊していないこと**を
実行計画と所要時間で確かめるのがこのスクリプトの目的である。

確かめたいのは次の 3 点。

1. 投稿（生存している `dish_media`）は何行あるか。**投稿枠の駆動表がこれ**なので、
   ここが小さいうちは «全国から投稿が多い順で N 件» を安く作れる
2. 投稿を持つ店は何件あるか（全店舗 57 万件に対してどれだけ小さいか）
3. `--explain` で **before（入札額順）と after（投稿が多い順）** を
   半径 50km と 1,500km の両方で EXPLAIN (ANALYZE, BUFFERS) して比べる

## 読み取り専用である

SELECT と、SELECT に対する EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_order_by_posts.py --schema dev
    python scripts/db-checks/measure_order_by_posts.py --schema dev --explain

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

# 日本全体を映したときの地図の中心（app-expo の REGION_JP。長野県あたり）と viewport の半径。
# measure_wide_area_search.py と同じ値を使う（比較できるようにするため）
JP_LAT, JP_LNG = 36.2048, 138.2529
JP_RADIUS_M = 1_500_000
# 東京駅。寄り（半径 50km）の比較用
TOKYO_LAT, TOKYO_LNG = 35.681236, 139.767125
LIMIT = 20

ORIGIN = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"

# 測る条件。(ラベル, 中心 lat, 中心 lng, 半径 m)
CASES = (
    ("日本全体（中心 REGION_JP / 半径 1,500km）", JP_LAT, JP_LNG, JP_RADIUS_M),
    ("東京駅から 50km", TOKYO_LAT, TOKYO_LNG, 50_000),
)


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
    section("1. 投稿の母数（投稿枠の駆動表が何行あるか）")

    total_restaurants = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total_restaurants:,}")

    alive_media = one(
        cur, "SELECT count(*) FROM dish_media WHERE deleted_at IS NULL"
    )
    deleted_media = one(
        cur, "SELECT count(*) FROM dish_media WHERE deleted_at IS NOT NULL"
    )
    logger.info(
        "dish_media（生存 / 削除済み）: %s / %s  ← 投稿枠が走る行数はここで決まる",
        f"{alive_media:,}",
        f"{deleted_media:,}",
    )

    with_posts = one(
        cur,
        """
        SELECT count(DISTINCT d.restaurant_id)
        FROM dish_media dm JOIN dishes d ON d.id = dm.dish_id
        WHERE dm.deleted_at IS NULL
        """,
    )
    logger.info(
        "投稿を持つ店の件数: %s（全店舗の %.4f%%）",
        f"{with_posts:,}",
        100.0 * with_posts / total_restaurants if total_restaurants else 0.0,
    )

    logger.info("")
    logger.info("投稿数の上位 10 店（新しい並びで先頭に来る店。目視確認用）:")
    cur.execute(
        """
        SELECT r.name, count(*)::int AS post_count
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        JOIN restaurants r ON r.id = d.restaurant_id
        WHERE dm.deleted_at IS NULL
        GROUP BY r.id, r.name
        ORDER BY post_count DESC, r.id ASC
        LIMIT 10
        """
    )
    for name, count in cur.fetchall():
        logger.info("  %5d 投稿  %s", count, name)

    logger.info("")
    logger.info("投稿枠が使う索引（dish_media / dishes）:")
    cur.execute(
        """
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('dish_media', 'dishes') AND schemaname = current_schema()
        ORDER BY tablename, indexname
        """
    )
    for name, definition in cur.fetchall():
        logger.info("  %s: %s", name, definition)


# ---------------------------------------------------------------------------
# EXPLAIN 用のクエリ形
#
# ⚠️ api/src/v1/restaurants/restaurants.repository.ts の SQL を «同じ形» で写している。
#    repository を直したらこちらも直すこと。
# ---------------------------------------------------------------------------

# before: 入札額順（#1629 前半。スポンサー枠 = restaurant_bids 駆動 + KNN の近傍枠）
BEFORE = f"""
WITH sponsored AS (
  SELECT rb.restaurant_id AS id,
         SUM(rb.amount_cents)::double precision AS total_cents,
         MAX(rb.end_date) AS max_end_date
  FROM restaurant_bids rb
  JOIN restaurants r ON r.id = rb.restaurant_id
  WHERE rb.status = 'paid'
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE
    AND ST_DWithin(r.location, {ORIGIN}, %s)
  GROUP BY rb.restaurant_id
  ORDER BY total_cents DESC LIMIT %s
),
nearest AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, {ORIGIN}, %s)
    AND NOT EXISTS (SELECT 1 FROM sponsored s WHERE s.id = r.id)
  ORDER BY r.location <-> {ORIGIN} LIMIT %s
),
candidates AS (
  SELECT id, 0 AS tier, total_cents, max_end_date FROM sponsored
  UNION ALL
  SELECT id, 1 AS tier, 0::double precision, NULL::date FROM nearest
)
SELECT r.id, c.total_cents, c.max_end_date,
       COUNT(dr.id)::int AS review_count,
       COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.tier, c.total_cents, c.max_end_date
ORDER BY c.tier ASC, c.total_cents DESC, ST_Distance(r.location, {ORIGIN}) ASC
LIMIT %s
"""

# after: 投稿が多い順（投稿枠 = dish_media 駆動 + KNN の近傍枠）。
# 入札は «並びに使わない» が meta としては返すので、候補が limit 件に決まったあとに集計する。
AFTER = f"""
WITH posted AS (
  SELECT d.restaurant_id AS id,
         COUNT(*)::int AS post_count,
         MIN(ST_Distance(r.location, {ORIGIN})) AS distance_m
  FROM dish_media dm
  JOIN dishes d ON d.id = dm.dish_id
  JOIN restaurants r ON r.id = d.restaurant_id
  WHERE dm.deleted_at IS NULL
    AND ST_DWithin(r.location, {ORIGIN}, %s)
  GROUP BY d.restaurant_id
  ORDER BY post_count DESC, distance_m ASC LIMIT %s
),
nearest AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, {ORIGIN}, %s)
    AND NOT EXISTS (SELECT 1 FROM posted p WHERE p.id = r.id)
  ORDER BY r.location <-> {ORIGIN} LIMIT %s
),
base AS (
  SELECT id, 0 AS tier, post_count FROM posted
  UNION ALL
  SELECT id, 1 AS tier, 0::int AS post_count FROM nearest
),
candidates AS (
  SELECT b.id, b.tier, b.post_count,
         COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
         MAX(rb.end_date) AS max_end_date
  FROM base b
  LEFT JOIN restaurant_bids rb ON rb.restaurant_id = b.id
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
  GROUP BY b.id, b.tier, b.post_count
)
SELECT r.id, c.post_count, c.total_cents, c.max_end_date,
       COUNT(dr.id)::int AS review_count,
       COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.tier, c.post_count, c.total_cents, c.max_end_date
ORDER BY c.tier ASC, c.post_count DESC, ST_Distance(r.location, {ORIGIN}) ASC, r.id ASC
LIMIT %s
"""

# «壊れた版»（回帰の見張り。半径内の全店を集計してから投稿数で並べる）。
# --explain-naive を付けたときだけ測る。**この形に戻すと全国で 9.7 秒級に戻る**
NAIVE = f"""
WITH nearby AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, {ORIGIN}, %s)
),
candidates AS (
  SELECT n.id,
         (SELECT COUNT(*)::int FROM dishes d2
            JOIN dish_media dm2 ON dm2.dish_id = d2.id AND dm2.deleted_at IS NULL
           WHERE d2.restaurant_id = n.id) AS post_count
  FROM nearby n
  ORDER BY post_count DESC
  LIMIT %s
)
SELECT r.id, c.post_count,
       COUNT(dr.id)::int AS review_count
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.post_count
ORDER BY c.post_count DESC
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


def log_plan(title, plan, full):
    logger.info("## %s", title)
    for line in plan:
        stripped = line.strip()
        if full or "Scan" in stripped or stripped.startswith("Execution Time"):
            logger.info("   %s", stripped)
    logger.info("")


def timed(cur, label, sql, params, full):
    """タイムアウトしたら «実用にならない» として記録し、後続を続ける。"""
    try:
        plan, exec_ms = explain(cur, sql, params)
        log_plan(label, plan, full)
        return exec_ms
    except psycopg2.errors.QueryCanceled:
        cur.connection.rollback()
        cur.execute(f'SET search_path TO "{SCHEMA[0]}", extensions')
        cur.execute("SET LOCAL statement_timeout = '120s'")
        logger.info("## %s", label)
        logger.info("   ⏱ 120 秒でタイムアウト（= 実用にならない）")
        logger.info("")
        return None


def run_explain(cur, naive, full):
    section("2. 所要時間 before（入札額順） / after（投稿が多い順）")
    logger.info(
        "before = スポンサー枠（restaurant_bids 駆動）+ KNN 近傍枠 / "
        "after = 投稿枠（dish_media 駆動）+ KNN 近傍枠"
    )
    if naive:
        logger.info(
            "naive = «半径内の全店の投稿数を集計してから並べる»（戻してはいけない形）"
        )
    logger.info("")

    # 長時間クエリで CI を止めないための保険。EXPLAIN ANALYZE は実際に実行するので要る
    cur.execute("SET LOCAL statement_timeout = '120s'")

    for label, lat, lng, radius in CASES:
        before_ms = timed(
            cur,
            f"before / {label}",
            BEFORE,
            (lng, lat, radius, LIMIT, lng, lat, radius, lng, lat, LIMIT, lng, lat, LIMIT),
            full,
        )
        after_ms = timed(
            cur,
            f"after / {label}",
            AFTER,
            (
                lng, lat,               # posted の距離
                lng, lat, radius,       # posted の ST_DWithin
                LIMIT,
                lng, lat, radius,       # nearest の ST_DWithin
                lng, lat, LIMIT,        # nearest の KNN
                lng, lat, LIMIT,        # 最終 ORDER BY の距離
            ),
            full,
        )
        if before_ms and after_ms:
            logger.info(
                "   ⏱ %s: before %.1f ms → after %.1f ms（%+.1f ms）",
                label,
                before_ms,
                after_ms,
                after_ms - before_ms,
            )
            logger.info("")
        if naive:
            naive_ms = timed(
                cur, f"naive / {label}", NAIVE, (lng, lat, radius, LIMIT, LIMIT), full
            )
            if naive_ms and after_ms:
                logger.info(
                    "   ⏱ %s: naive %.1f ms に対して after %.1f ms（%.1f 倍速い）",
                    label,
                    naive_ms,
                    after_ms,
                    naive_ms / after_ms,
                )
                logger.info("")


# タイムアウト後に search_path を貼り直すために使う
SCHEMA = ["dev"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--explain",
        action="store_true",
        help="before / after を EXPLAIN (ANALYZE, BUFFERS) で比べる（重い）",
    )
    parser.add_argument(
        "--explain-naive",
        action="store_true",
        help="«戻してはいけない形»（半径内の全店を集計してから並べる）も一緒に測る（さらに重い）",
    )
    parser.add_argument(
        "--full-plan",
        action="store_true",
        help="実行計画を要約せず全行出す",
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
            logger.info(
                "接続先: user=%s db=%s schema=%s",
                one(cur, "SELECT current_user"),
                one(cur, "SELECT current_database()"),
                args.schema,
            )

            run_counts(cur)
            if args.explain or args.explain_naive:
                run_explain(cur, args.explain_naive, args.full_plan)

    return 0


if __name__ == "__main__":
    sys.exit(main())
