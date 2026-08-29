#!/usr/bin/env python3
"""近傍検索と店名検索を EXPLAIN ANALYZE で測る読み取り専用スクリプト。

## なぜ要るのか

#1629 の 14 / 15 / 16（「このエリアで再検索が遅い」「保存したお店の取得に失敗しました」
「店名検索が遅い」）に対して、次を入れてきた。

1. `api/src/v1/restaurants/restaurants.repository.ts` を bbox + acos から
   `ST_DWithin` / `ST_Distance` へ（#1634）
2. dev に無かった `idx_restaurants_location`（GIST）を揃え直した（#1638）
3. **KNN（`location <-> 点`）で候補を絞ってから集計する形へ組み替えた**（本スクリプトの主目的）

**入れたことと、効いていることは別である。** 1 と 2 の後も、索引に乗っているのに
半径 5km で 9.3 秒かかっていた。索引は «半径内か» までしか絞れず、
`ORDER BY ST_Distance(...)` が半径内の全件（東京駅 5km で 21,247 行）の距離を計算して
ソートし、さらに `dishes` / `dish_reviews` / `restaurant_bids` の集計まで
その 21,247 行に対して走っていたためである。

そこでこのスクリプトは 2 種類を測る。

* **述語だけの最小形**（`MINIMAL_CASES`）… 索引が選ばれるかの判定に使う
* **repository のクエリ形**（`REPOSITORY_CASES`）… 旧実装 (before) と新実装 (after) を
  同じ条件で並べて、画面が体感する所要時間そのものを比べる

さらに `--trgm-diagnosis` で、店名の中間一致が GIN 索引（`idx_restaurants_name_trgm`）に
乗らない理由を EXPLAIN と `show_trgm()` で切り分ける。

## 読み取り専用である

SELECT に対する EXPLAIN と、パラメータ調査用の SELECT しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_restaurants_nearby.py --schema dev
    python scripts/db-checks/measure_restaurants_nearby.py --schema dev --trgm-diagnosis
    python scripts/db-checks/measure_restaurants_nearby.py --schema dev --only repository

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
# API の既定ページサイズ（QueryRestaurantsDto.limit の既定値）
LIMIT = 20

NEARBY_SQL = """
SELECT r.id FROM restaurants r
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) ASC
LIMIT 100
"""

# KNN 演算子。GIST 索引から「近い順に n 件」を直接取り出す
NEARBY_KNN_SQL = """
SELECT r.id FROM restaurants r
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
LIMIT 100
"""

MINIMAL_CASES = [
    ("近傍 500m（このエリアで再検索の実用域）", NEARBY_SQL, (LNG, LAT, 500, LNG, LAT)),
    ("近傍 5km", NEARBY_SQL, (LNG, LAT, 5000, LNG, LAT)),
    (
        "近傍 50km（DTO の上限。以前は日本地図から 1,000km が飛んでいた）",
        NEARBY_SQL,
        (LNG, LAT, 50000, LNG, LAT),
    ),
    ("近傍 5km / KNN 版", NEARBY_KNN_SQL, (LNG, LAT, 5000, LNG, LAT)),
    ("近傍 50km / KNN 版", NEARBY_KNN_SQL, (LNG, LAT, 50000, LNG, LAT)),
    (
        "店名の中間一致（一蘭 / 2 文字）",
        "SELECT r.id FROM restaurants r WHERE r.name ILIKE %s LIMIT 100",
        ("%一蘭%",),
    ),
    (
        "店名の中間一致（ラーメン / 4 文字）",
        "SELECT r.id FROM restaurants r WHERE r.name ILIKE %s LIMIT 100",
        ("%ラーメン%",),
    ),
]

# ---------------------------------------------------------------------------
# repository のクエリ形（before / after）
#
# ⚠️ ここは restaurants.repository.ts の SQL を «同じ形» で写したものである。
#    repository を直したらこちらも直すこと。片方だけ変えると測っている対象がずれる。
# ---------------------------------------------------------------------------

# --- searchNearbyRestaurants: 既定（入札額順） -------------------------------
NEARBY_RESTAURANTS_BEFORE = """
SELECT
  r.id, r.google_place_id, r.name,
  COALESCE(SUM(rb.amount_cents), 0)::double precision as total_cents,
  MAX(rb.end_date) as max_end_date,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM restaurants r
LEFT JOIN restaurant_bids rb ON r.id = rb.restaurant_id
  AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
GROUP BY r.id
ORDER BY total_cents DESC
LIMIT %s
"""

NEARBY_RESTAURANTS_AFTER = """
WITH nearby AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
),
candidates AS (
  SELECT
    n.id,
    COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
    MAX(rb.end_date) AS max_end_date
  FROM nearby n
  LEFT JOIN restaurant_bids rb ON rb.restaurant_id = n.id
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
  GROUP BY n.id
  ORDER BY total_cents DESC
  LIMIT %s
)
SELECT
  r.id, r.google_place_id, r.name,
  c.total_cents, c.max_end_date,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.total_cents, c.max_end_date
ORDER BY total_cents DESC
LIMIT %s
"""

# --- searchNearbyRestaurants: 距離順（店名検索 / orderByDistance） -----------
NEARBY_RESTAURANTS_DISTANCE_BEFORE = """
SELECT
  r.id, r.google_place_id, r.name,
  COALESCE(SUM(rb.amount_cents), 0)::double precision as total_cents,
  MAX(rb.end_date) as max_end_date,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM restaurants r
LEFT JOIN restaurant_bids rb ON r.id = rb.restaurant_id
  AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
GROUP BY r.id
ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) ASC
LIMIT %s
"""

NEARBY_RESTAURANTS_DISTANCE_AFTER = """
WITH nearby AS (
  SELECT r.id FROM restaurants r
  WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
  ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
  LIMIT %s
),
candidates AS (
  SELECT
    n.id,
    COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
    MAX(rb.end_date) AS max_end_date
  FROM nearby n
  LEFT JOIN restaurant_bids rb ON rb.restaurant_id = n.id
    AND rb.start_date <= CURRENT_DATE AND rb.end_date > CURRENT_DATE AND rb.status = 'paid'
  GROUP BY n.id
)
SELECT
  r.id, r.google_place_id, r.name,
  c.total_cents, c.max_end_date,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.total_cents, c.max_end_date
ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) ASC
LIMIT %s
"""

# --- searchNearbySavedRestaurants ------------------------------------------
SAVED_PREFIX = """
WITH params AS (
  SELECT %s::double precision AS lat, %s::double precision AS lng,
         %s::double precision AS radius_km, %s::uuid AS user_id
),
saved_restaurants AS (
  SELECT d.restaurant_id, MAX(rct.created_at) AS last_saved_at
  FROM reactions rct
  JOIN dish_media dm ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
  JOIN dishes d ON d.id = dm.dish_id
  JOIN params p ON TRUE
  WHERE rct.user_id = p.user_id AND rct.action_type = 'save' AND rct.target_type = 'dish_media'
  GROUP BY d.restaurant_id
)
"""

SAVED_BEFORE = (
    SAVED_PREFIX
    + """
SELECT
  r.id, r.name,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating,
  sr.last_saved_at
FROM saved_restaurants sr
JOIN restaurants r ON r.id = sr.restaurant_id
JOIN params p ON TRUE
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, p.radius_km * 1000)
GROUP BY r.id, sr.last_saved_at
ORDER BY sr.last_saved_at DESC
LIMIT %s OFFSET 0
"""
)

SAVED_AFTER = (
    SAVED_PREFIX
    + """,
candidates AS (
  SELECT r.id, sr.last_saved_at
  FROM saved_restaurants sr
  JOIN restaurants r ON r.id = sr.restaurant_id
  JOIN params p ON TRUE
  WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, p.radius_km * 1000)
  ORDER BY sr.last_saved_at DESC
  LIMIT %s OFFSET 0
)
SELECT
  r.id, r.name,
  COUNT(dr.id)::int AS review_count,
  COALESCE(AVG(dr.rating), 0)::double precision AS average_rating,
  c.last_saved_at
FROM candidates c
JOIN restaurants r ON r.id = c.id
LEFT JOIN dishes d ON d.restaurant_id = r.id
LEFT JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
GROUP BY r.id, c.last_saved_at
ORDER BY c.last_saved_at DESC
"""
)


def explain(cur, sql, params):
    """EXPLAIN (ANALYZE, BUFFERS) を実行し、行の配列と実行時間（ms）を返す。"""
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
    if any("Seq Scan on restaurants" in line for line in plan):
        logger.info("   ⚠️ Seq Scan（索引が選ばれていない）")
    else:
        logger.info("   ✅ 索引が選ばれている")
    logger.info("")
    return exec_ms


def run_minimal(cur):
    logger.info("=" * 70)
    logger.info("# 述語だけの最小形（索引が選ばれるかの判定）")
    logger.info("=" * 70)
    logger.info("")
    for title, sql, params in MINIMAL_CASES:
        plan, exec_ms = explain(cur, sql, params)
        log_plan(title, plan, exec_ms)


def run_repository(cur, user_id):
    """repository のクエリ形で before / after を並べて測る。"""
    logger.info("=" * 70)
    logger.info("# repository のクエリ形（before = 旧実装 / after = KNN 版）")
    logger.info("=" * 70)
    logger.info("")

    cases = []
    for radius in (500, 5000, 50000):
        cases.append(
            (
                f"searchNearbyRestaurants 既定（入札額順） 半径 {radius}m",
                (NEARBY_RESTAURANTS_BEFORE, (LNG, LAT, radius, LIMIT)),
                (NEARBY_RESTAURANTS_AFTER, (LNG, LAT, radius, LIMIT, LIMIT)),
            )
        )
        cases.append(
            (
                f"searchNearbyRestaurants 距離順（店名検索 / 住所照合） 半径 {radius}m",
                (
                    NEARBY_RESTAURANTS_DISTANCE_BEFORE,
                    (LNG, LAT, radius, LNG, LAT, LIMIT),
                ),
                (
                    NEARBY_RESTAURANTS_DISTANCE_AFTER,
                    (LNG, LAT, radius, LNG, LAT, LIMIT, LNG, LAT, LIMIT),
                ),
            )
        )

    if user_id:
        for radius in (5000, 50000):
            cases.append(
                (
                    f"searchNearbySavedRestaurants（保存日時順） 半径 {radius}m",
                    (SAVED_BEFORE, (LAT, LNG, radius / 1000, user_id, LIMIT)),
                    (SAVED_AFTER, (LAT, LNG, radius / 1000, user_id, LIMIT)),
                )
            )
    else:
        logger.info("⚠️ save の reaction を持つユーザーが居ないため、保存済み一覧は測らない")
        logger.info("")

    for title, (before_sql, before_params), (after_sql, after_params) in cases:
        before_plan, before_ms = explain(cur, before_sql, before_params)
        after_plan, after_ms = explain(cur, after_sql, after_params)
        log_plan(f"{title} — before", before_plan, before_ms)
        log_plan(f"{title} — after", after_plan, after_ms)
        if before_ms and after_ms:
            logger.info(
                "   ⏱ %s: before %.1f ms → after %.1f ms（%.1f 倍）",
                title,
                before_ms,
                after_ms,
                before_ms / after_ms if after_ms else float("nan"),
            )
        logger.info("")


def run_trgm_diagnosis(cur):
    """店名の中間一致が GIN 索引に乗らない理由を切り分ける。

    仮説は 3 つある。«2 文字だからトライグラムが作れない» / «索引が別スキーマの
    演算子クラスを解決できない» / «コスト見積もりで負けている»。順に潰す。
    """
    logger.info("=" * 70)
    logger.info("# 店名の中間一致が GIN（idx_restaurants_name_trgm）に乗らない理由")
    logger.info("=" * 70)
    logger.info("")

    cur.execute(
        """
        SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid),
               n.nspname
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_restaurants_name_trgm'
        """
    )
    rows = cur.fetchall()
    if not rows:
        logger.info("❌ idx_restaurants_name_trgm が存在しない")
    for valid, ready, definition, nspname in rows:
        logger.info("索引: schema=%s valid=%s ready=%s", nspname, valid, ready)
        logger.info("      %s", definition)
    logger.info("")

    cur.execute("SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'pg_trgm'")
    row = cur.fetchone()
    logger.info("pg_trgm のスキーマ: %s", row[0] if row else "（未インストール）")
    cur.execute("SHOW search_path")
    logger.info("search_path: %s", cur.fetchone()[0])
    logger.info("")

    # ★ 本命の検証。トライグラムはパターンから 3 文字の並びを取り出せないと使えない。
    #    2 文字の「一蘭」からは 1 つも取り出せず、索引は原理的に使えない。
    for word in ("一蘭", "熊喜", "ラーメン", "居酒屋"):
        cur.execute("SELECT show_trgm(%s)", (word,))
        trgm = cur.fetchone()[0]
        logger.info("show_trgm(%r) = %s（%d 個）", word, trgm, len(trgm))
    logger.info("")
    logger.info(
        "→ ILIKE '%%〜%%' の中間一致で GIN を使うには、パターン «内部» の連続 3 文字が要る。"
    )
    logger.info(
        "   show_trgm が返す先頭の «空白 2 つ + 1 文字» のような要素は語境界のもので、"
    )
    logger.info("   中間一致のパターンからは取り出せない。")
    logger.info("")

    # コスト見積もりで負けているだけなら、seqscan を切れば索引が選ばれる。
    # 2 文字で切っても Seq Scan のままなら «原理的に使えない» が確定する。
    for label, pattern in (("2 文字（一蘭）", "%一蘭%"), ("4 文字（ラーメン）", "%ラーメン%")):
        sql = "SELECT r.id FROM restaurants r WHERE r.name ILIKE %s LIMIT 100"
        plan, exec_ms = explain(cur, sql, (pattern,))
        log_plan(f"{label} / 既定", plan, exec_ms)
        cur.execute("SET LOCAL enable_seqscan = off")
        plan, exec_ms = explain(cur, sql, (pattern,))
        log_plan(f"{label} / enable_seqscan=off で強制", plan, exec_ms)
        cur.execute("SET LOCAL enable_seqscan = on")
    logger.info(
        "→ enable_seqscan=off でも Seq Scan なら «プランナの気まぐれ» ではなく "
        "«索引が原理的に使えない» である。"
    )
    logger.info("")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--only",
        choices=("minimal", "repository", "all"),
        default="all",
        help="測る対象を絞る",
    )
    parser.add_argument(
        "--trgm-diagnosis",
        action="store_true",
        help="店名の中間一致が GIN に乗らない理由を切り分ける",
    )
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

            # 保存済み一覧を測るには、実際に save している user が要る
            cur.execute(
                """
                SELECT user_id FROM reactions
                WHERE action_type = 'save' AND target_type = 'dish_media'
                GROUP BY user_id ORDER BY count(*) DESC LIMIT 1
                """
            )
            row = cur.fetchone()
            user_id = row[0] if row else None
            logger.info("保存済み一覧の測定に使うユーザー: %s", user_id or "（該当なし）")
            logger.info("")

            if args.only in ("minimal", "all"):
                run_minimal(cur)
            if args.only in ("repository", "all"):
                run_repository(cur, user_id)
            if args.trgm_diagnosis:
                run_trgm_diagnosis(cur)

    return 0


if __name__ == "__main__":
    sys.exit(main())
