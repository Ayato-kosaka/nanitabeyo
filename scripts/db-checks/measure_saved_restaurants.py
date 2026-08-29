#!/usr/bin/env python3
"""「保存したお店」の地図（GET /v1/users/me/saved-restaurants）を EXPLAIN ANALYZE で測る。

## なぜ要るのか

オーナー報告:「食べたを記録 → マップアイコン → このエリアで再取得がめっちゃ遅い。
**拡大しても遅い**」「このエリアで再取得でピンが表示されない」。

dev の実測（BigQuery nanitabeyo_logs_dev）:

| 半径 | 所要 |
| ---: | ---: |
| 5,480 m | 8,319 ms |
| 19,969 m | 17,797 ms |
| 389,333 m | 47,353 ms |
| 1,430,410 m | 44 ms / 190 ms / 24,564 ms（**同じ半径で 3 桁ぶれる**） |

クライアントは 30 秒で中断する（api_call_timeout → saved_restaurants_search_error）。
**「ピンが出ない」はバグではなくこのタイムアウトである。**

## 何を測るのか

1. **母数**: reactions の行数 / target_id の型 / 索引一覧、そのユーザーの save の件数、
   保存した店が半径内に何件あるか。「保存の件数のせいで遅い」のかを最初に潰す
2. **before / after を同じ半径で並べて EXPLAIN (ANALYZE, BUFFERS)**。
   半径は 5km / 20km / 1,500km（オーナーが実際に踏んだ値に合わせてある）
3. **generic plan でも同じか**（`plan_cache_mode = force_generic_plan`）。
   Prisma は prepared statement を投げるので、PostgreSQL は同じ文を繰り返すうちに
   «パラメータの値を見ないプラン» へ切り替える。dev のログで «同じ半径なのに
   44 ms と 24,564 ms» が混在するのはこれで説明が付く。**ここを測らないと直ったか分からない。**

## 何が原因だったのか（ローカル再現環境での結論。dev で追認するのがこのスクリプトの役目）

before は lat / lng / radius を `params` という CTE にまとめて
`ST_DWithin(..., p.radius_km * 1000)` と書いていた。半径が CTE の向こう側にあると
プランナから値が見えず、GIST 索引の行数見積りが既定値へ落ちる:

    Bitmap Index Scan on idx_restaurants_location
      (cost=0.00..4.84 rows=40) (actual rows=59,527)   ← 1,000 倍以上の過小見積り

その結果 **restaurants を駆動表にして半径内の全店を取り出し、
保存済み（dev で 154 行）を Hash Join** するプランになる。走る行数が半径に比例するので
「拡大しても遅い」「広げるともっと遅い」の両方が説明できる。

after は saved_restaurants を外側に置き、LATERAL + LIMIT 1 で restaurants を
主キーで 1 件ずつ引く。プランナは nested loop 以外を選べず、走る行数は
«保存した店の数» で決まる（半径に依存しない）。

## 読み取り専用である

SELECT と、SELECT に対する EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_saved_restaurants.py --schema dev
    python scripts/db-checks/measure_saved_restaurants.py --schema dev --user-id <uuid>

`--user-id` を省略すると «save が最も多いユーザー» を自動で選ぶ（= 最悪ケース）。

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

LIMIT, OFFSET = 20, 0

# 東京駅。従来の計測地点
LAT, LNG = 35.681236, 139.767125

# ⚠️ **中心も半径も «オーナーが実際に投げた値» で測ること。**
#
# 2026-08-29 に「まだ直っていない」と言われて BigQuery の実ログを引いたところ、
# サーバ自身が **42,007 ms**（app_ms 42,004）かかっているリクエストが見つかった:
#
#   /v1/users/me/saved-restaurants?lat=36.474490&lng=139.304243&radius=228012  → 42,007 ms
#   /v1/users/me/saved-restaurants?lat=36.020342&lng=139.637042&radius=74225   →  5,357 ms
#   /v1/users/me/saved-restaurants?lat=36.2048&lng=138.2529&radius=1430410     →    160 ms
#
# **それまでの計測は 3 行目（REGION_JP の初期表示）しか踏んでいなかった**ので、
# 「速い」と誤読していた。中心が変わると保存済みの店が半径内から消え、
# プランが変わりうる。**中心を固定した半径スイープだけでは足りない。**
POINTS = [
    ("東京駅 5.5km", 35.681236, 139.767125, 5_480),
    ("東京駅 20km", 35.681236, 139.767125, 19_969),
    ("東京駅 389km", 35.681236, 139.767125, 389_333),
    ("REGION_JP 1,430km（初期表示・従来ここだけ測っていた）", 36.2048, 138.2529, 1_430_410),
    ("⚠️実測 42.0 秒: 36.474/139.304 半径 228km", 36.474490512258626, 139.30424323305488, 228_012),
    ("⚠️実測 5.4 秒: 36.020/139.637 半径 74km", 36.020342181469665, 139.63704250752926, 74_225),
]

# ---------------------------------------------------------------------------
# before … 修正前の SQL（params CTE + restaurants との普通の join + GROUP BY 集計）
# ---------------------------------------------------------------------------
BEFORE_SQL = """
WITH params AS (
  SELECT %(lat)s::double precision AS lat,
         %(lng)s::double precision AS lng,
         (%(radius)s::double precision / 1000) AS radius_km,
         %(user_id)s::uuid AS user_id
),
saved_restaurants AS (
  SELECT d.restaurant_id, MAX(rct.created_at) AS last_saved_at
  FROM reactions rct
  JOIN dish_media dm ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
  JOIN dishes d ON d.id = dm.dish_id
  JOIN params p ON TRUE
  WHERE rct.user_id = p.user_id
    AND rct.action_type = 'save'
    AND rct.target_type = 'dish_media'
  GROUP BY d.restaurant_id
),
candidates AS (
  SELECT r.id, sr.last_saved_at
  FROM saved_restaurants sr
  JOIN restaurants r ON r.id = sr.restaurant_id
  JOIN params p ON TRUE
  WHERE ST_DWithin(r.location,
                   ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                   p.radius_km * 1000)
  ORDER BY sr.last_saved_at DESC
  LIMIT %(limit)s OFFSET %(offset)s
)
SELECT r.id,
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

# ---------------------------------------------------------------------------
# after … 修正後の SQL（api/src/v1/restaurants/restaurants.repository.ts と同じ形）
#   ⚠️ LATERAL の LIMIT 1 を消さないこと。消すと subquery pullup で before のプランに戻る
# ---------------------------------------------------------------------------
AFTER_SQL = """
WITH saved_restaurants AS (
  SELECT d.restaurant_id, MAX(rct.created_at) AS last_saved_at
  FROM reactions rct
  JOIN dish_media dm ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
  JOIN dishes d ON d.id = dm.dish_id
  WHERE rct.user_id = %(user_id)s::uuid
    AND rct.action_type = 'save'
    AND rct.target_type = 'dish_media'
  GROUP BY d.restaurant_id
),
candidates AS (
  SELECT hit.id, sr.last_saved_at
  FROM saved_restaurants sr
  JOIN LATERAL (
    SELECT r.id
    FROM restaurants r
    WHERE r.id = sr.restaurant_id
      AND ST_DWithin(r.location,
                     ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
                     %(radius)s::double precision)
    LIMIT 1
  ) hit ON TRUE
  ORDER BY sr.last_saved_at DESC
  LIMIT %(limit)s OFFSET %(offset)s
)
SELECT r.id,
       agg.review_count,
       agg.average_rating,
       c.last_saved_at
FROM candidates c
JOIN restaurants r ON r.id = c.id
JOIN LATERAL (
  SELECT COUNT(dr.id)::int AS review_count,
         COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
  FROM dishes d
  JOIN dish_reviews dr ON dr.dish_id = d.id AND dr.deleted_at IS NULL
  WHERE d.restaurant_id = r.id
) agg ON TRUE
ORDER BY c.last_saved_at DESC
"""


def one(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return row[0] if row else None


def section(title):
    logger.info("")
    logger.info("=" * 72)
    logger.info("# %s", title)
    logger.info("=" * 72)


def run_counts(cur, user_id):
    section("1. 母数（«保存の件数» で遅さを説明できるのかを最初に潰す）")

    logger.info("reactions の総行数: %s", f"{one(cur, 'SELECT count(*) FROM reactions'):,}")
    col_type = one(
        cur,
        """
        SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        WHERE a.attrelid = 'reactions'::regclass AND a.attname = 'target_id'
        """,
    )
    logger.info("reactions.target_id の型: %s", col_type)
    logger.info("  → text なら join で ::uuid が要る。**キャストは reactions 側（外側）に置くこと**。")
    logger.info("    逆向き（dm.id::text）にすると dish_media の主キー索引が使えなくなる。")

    logger.info("")
    logger.info("reactions の索引:")
    cur.execute(
        "SELECT indexname, indexdef FROM pg_indexes "
        "WHERE tablename = 'reactions' AND schemaname = current_schema()"
    )
    for name, definition in cur.fetchall():
        logger.info("  - %s", definition)

    logger.info("")
    logger.info("restaurants の総件数: %s", f"{one(cur, 'SELECT count(*) FROM restaurants'):,}")
    saved = one(
        cur,
        "SELECT count(*) FROM reactions WHERE user_id = %s::uuid "
        "AND action_type = 'save' AND target_type = 'dish_media'",
        (user_id,),
    )
    logger.info("対象ユーザーの save（dish_media）: %s 行", f"{saved:,}")
    logger.info("  ← これが数百行なら、8 秒かかる理由は «保存の件数» ではない")

    logger.info("")
    for label, lat, lng, radius in POINTS:
        n = one(
            cur,
            """
            WITH sr AS (
              SELECT DISTINCT d.restaurant_id
              FROM reactions rct
              JOIN dish_media dm ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
              JOIN dishes d ON d.id = dm.dish_id
              WHERE rct.user_id = %(user_id)s::uuid
                AND rct.action_type = 'save' AND rct.target_type = 'dish_media'
            )
            SELECT count(*) FROM sr
            JOIN restaurants r ON r.id = sr.restaurant_id
            WHERE ST_DWithin(r.location,
                             ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
                             %(radius)s::double precision)
            """,
            {"user_id": user_id, "lat": lat, "lng": lng, "radius": radius},
        )
        total_in_radius = one(
            cur,
            "SELECT count(*) FROM restaurants r WHERE ST_DWithin(r.location, "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s::double precision)",
            (lng, lat, radius),
        )
        logger.info(
            "%-52s 保存した店 %5s 件 / 半径内の全店 %10s 件",
            label,
            f"{n:,}",
            f"{total_in_radius:,}",
        )
    logger.info("")
    logger.info("  ← 右の «半径内の全店» に比例して遅くなるなら、駆動表を間違えている")


def explain(cur, sql, params, generic=False):
    """EXPLAIN (ANALYZE, BUFFERS) を実行し、(プラン行, 実行時間 ms) を返す"""
    if generic:
        cur.execute("SET LOCAL plan_cache_mode = force_generic_plan")
    else:
        cur.execute("SET LOCAL plan_cache_mode = force_custom_plan")
    cur.execute("EXPLAIN (ANALYZE, BUFFERS) " + sql, params)
    plan = [row[0] for row in cur.fetchall()]
    exec_ms = None
    for line in plan:
        if line.strip().startswith("Execution Time"):
            exec_ms = float(line.strip().split(":")[1].strip().split(" ")[0])
    return plan, exec_ms


def summarize(plan):
    """遅いプランの目印だけを拾う"""
    marks = []
    for line in plan:
        s = line.strip()
        if "Seq Scan" in s or "Bitmap Index Scan on idx_restaurants_location" in s:
            marks.append(s)
    return marks


def run_explain(cur, user_id, schema):
    section("2. before / after を同じ半径で比べる（EXPLAIN ANALYZE）")
    logger.info("before = 修正前（params CTE + restaurants 駆動になりうる形）")
    logger.info("after  = 修正後（saved_restaurants を外側に置いた LATERAL）")

    for generic in (False, True):
        mode = "generic plan（Prisma の prepared statement が落ち着く先）" if generic else "custom plan（初回数回）"
        logger.info("")
        logger.info("-" * 72)
        logger.info("## %s", mode)
        logger.info("-" * 72)
        for label, lat, lng, radius in POINTS:
            params = {
                "user_id": user_id,
                "lat": lat,
                "lng": lng,
                "radius": radius,
                "limit": LIMIT,
                "offset": OFFSET,
            }
            row = [label]
            for name, sql in (("before", BEFORE_SQL), ("after", AFTER_SQL)):
                cur.execute("SET LOCAL statement_timeout = '120s'")
                try:
                    plan, ms = explain(cur, sql, params, generic=generic)
                except psycopg2.errors.QueryCanceled:
                    cur.connection.rollback()
                    cur.execute(f'SET search_path TO "{schema}", extensions')
                    row.append(f"{name}: 120s timeout")
                    continue
                marks = summarize(plan)
                row.append(f"{name}: {ms:.1f} ms")
                if marks:
                    row.append("     ⚠ " + " / ".join(marks[:2]))
            logger.info("%-32s %s", row[0], "  ".join(row[1:]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--user-id",
        default=None,
        help="測る対象のユーザー。省略すると save が最も多いユーザー（＝最悪ケース）",
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
            logger.info(
                "接続先: user=%s db=%s schema=%s",
                one(cur, "SELECT current_user"),
                one(cur, "SELECT current_database()"),
                args.schema,
            )

            user_id = args.user_id
            if not user_id:
                user_id = one(
                    cur,
                    "SELECT user_id FROM reactions "
                    "WHERE action_type = 'save' AND target_type = 'dish_media' "
                    "GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
                )
                logger.info("対象ユーザー（save が最多）: %s", user_id)
            if not user_id:
                logger.error("❌ save の reaction が 1 件も無いため測れない")
                return 1

            run_counts(cur, user_id)
            run_explain(cur, user_id, args.schema)

    return 0


if __name__ == "__main__":
    sys.exit(main())
