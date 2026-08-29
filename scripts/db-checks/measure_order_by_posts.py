#!/usr/bin/env python3
"""#1629 GET /v1/restaurants/search を **実運用と同じ条件で** 測り、遅いプランなら赤にする。

## なぜ要るのか

「投稿が多い順」を入れた commit 3dfd061d のあと、dev の
GET /v1/restaurants/search（東京駅・半径 20,000m・limit 20）が
**7,625 / 16,222 / 25,954 ms** かかった（queue_ms は 1〜2 ms なので接続待ちではない）。

ところが同じ SQL を **literal 埋め込みで EXPLAIN ANALYZE すると 46〜270 ms で速い**。
測り方が実運用と違っていたのである。Prisma が投げるのは prepared statement なので、
PostgreSQL は同じ文を数回実行したあと **generic plan**（パラメータの値を見ないプラン）
へ切り替える。半径がプランナから見えなくなると GIST 索引の見積りが既定値へ落ち、
**restaurants を駆動表にして半径内の全店を読む**プランが選ばれる。

⚠️ psycopg2 の execute(sql, params) はクライアント側で値を埋め込むので、
   そのまま EXPLAIN しても prepared statement にならない。
   **plan_cache_mode は効かない**（＝ generic plan を測ったことにならない）。
   このスクリプトが PREPARE / EXECUTE を使うのはそのためである。

## 何を測るのか

1. 母数（restaurants / 投稿 / 投稿を持つ店 / 半径内の店舗数）
2. `custom plan`（最初の数回）と `generic plan`（落ち着く先）の両方で
   EXPLAIN (ANALYZE, BUFFERS) EXECUTE
3. **判定**: **custom / generic の両方**で、**restaurants から読んだ延べ行数**を見る。
   «半径内の全店を読む» プランへ倒れると、この数が半径に比例して跳ね上がる。

   ⚠️ **片方だけ見てはいけない。** #1686 で generic plan を直したあと、
      このスクリプトが generic しか判定していなかったため、
      **custom plan が 11〜13 秒のまま «✅» と表示された**（dev run 33229509189）。
      «空振りを ✅ と読む» のを構造的に潰すため、両方を判定対象にしてある。

   再現環境（restaurants 570,000 行 / 投稿を持つ店 7,985 / limit 20。
   max_parallel_workers_per_gather=4 / random_page_cost=1.1 ＝ dev と同じプランが出る設定）:

   | | custom 延べ行数 / 所要 | generic 延べ行数 / 所要 |
   | --- | ---: | ---: |
   | #1686 時点 半径 20km    | 272,612 / 994 ms | 60 / 173 ms |
   | #1686 時点 半径 1,500km | 574,385 / 1,733 ms | 8,045 / 173 ms |
   | 修正後 半径 20km        | 60 / 158 ms | 60 / 167 ms |
   | 修正後 半径 1,500km     | 8,045 / 167 ms | 8,045 / 172 ms |

## 測る SQL は写経しない

⚠️ 「repository を直したのに、このスクリプトの写経が古いままで同じ遅い数字が出て
   «直っていない» と誤読しかけた」事故が起きている。

そこで SQL は `scripts/db-checks/sql/*.sql` から読む。このファイルは
`api/src/v1/restaurants/restaurants.order-by-posts-plan.spec.ts` が
**repository の組み立て結果と一致することを機械検査している**ので、
写経がずれることは起きない（ずれたら `pnpm --filter api exec jest` が赤くなる）。

## 読み取り専用である

SELECT と、SELECT に対する PREPARE / EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_order_by_posts.py --schema dev
    python scripts/db-checks/measure_order_by_posts.py --schema dev --assert

`--assert` を付けると、generic plan で restaurants を舐めるプランになっている場合に
**終了コード 1** を返す（ラチェットとして使う）。

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"

# 東京駅。オーナーが実際に踏んだ検索地点
TOKYO_LAT, TOKYO_LNG = 35.681236, 139.767125
# 日本全体を映したときの地図の中心（app-expo の REGION_JP）と viewport の半径
JP_LAT, JP_LNG = 36.2048, 138.2529
LIMIT = 20

# 測る条件。(ラベル, 中心 lat, 中心 lng, 半径 m)
#   ⚠️ 20,000m / limit 20 はオーナーが実際に踏んだ値。必ず含めること
CASES = (
    ("東京駅から 20km（オーナーが実際に踏んだ条件）", TOKYO_LAT, TOKYO_LNG, 20_000),
    ("東京駅から 50km", TOKYO_LAT, TOKYO_LNG, 50_000),
    ("日本全体（中心 REGION_JP / 半径 1,500km）", JP_LAT, JP_LNG, 1_500_000),
)

# 判定のしきい値。«走る行数が limit 件で一定» が保てているなら、
# restaurants から読む延べ行数は «投稿を持つ店の数 + limit の数倍» に収まる。
# 半径内の全店を読むプランへ戻ると桁が変わるので、緩めに取っても検出できる
ROWS_BUDGET_MULTIPLIER = 4


def one(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return row[0] if row else None


def section(title):
    logger.info("")
    logger.info("=" * 72)
    logger.info("# %s", title)
    logger.info("=" * 72)


def load_sql(name):
    """repository が組み立てた SQL とバインド値の «名前の列» を読む。

    バインド位置は半角疑問符なので $1, $2 … へ直す。
    ⚠️ SQL のコメントに半角疑問符が混ざっていると位置がずれる。
       repository 側でそれを禁じ、jest が個数一致を検査している。
    """
    raw = (SQL_DIR / f"{name}.sql").read_text(encoding="utf-8").rstrip().rstrip(";")
    names = json.loads((SQL_DIR / f"{name}.params.json").read_text(encoding="utf-8"))
    counter = [0]

    def to_positional(_match):
        counter[0] += 1
        return f"${counter[0]}"

    sql = re.sub(r"\?", to_positional, raw)
    if counter[0] != len(names):
        raise SystemExit(
            f"❌ {name}: プレースホルダ {counter[0]} 個に対して名前が {len(names)} 個。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 で書き出し直すこと"
        )
    return sql, names


def bind(names, lat, lng, radius, limit):
    """バインド値を «名前の列» の順に並べる。

    ⚠️ ここを手書きの配列にしないこと。SQL の形を変えるとバインドの順番も変わり、
       radius と limit が入れ替わったまま «別のクエリを測って» 読み違えた実績がある。
       名前の列は jest が repository から書き出しているので、ずれようがない。
    """
    values = {"lat": lat, "lng": lng, "radius": radius, "limit": limit}
    return [values[n] for n in names]


def run_counts(cur, schema):
    section("1. 母数（«何行あるから遅い» のかを最初に潰す）")

    total = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total:,}")

    alive = one(cur, "SELECT count(*) FROM dish_media WHERE deleted_at IS NULL")
    logger.info("dish_media（生存）: %s  ← post_counts CTE が 1 回走る行数", f"{alive:,}")

    with_posts = one(
        cur,
        """
        SELECT count(DISTINCT d.restaurant_id)
        FROM dish_media dm JOIN dishes d ON d.id = dm.dish_id
        WHERE dm.deleted_at IS NULL
        """,
    )
    logger.info(
        "投稿を持つ店: %s 件（全店舗の %.4f%%）  ← 投稿枠が走る行数の上限",
        f"{with_posts:,}",
        100.0 * with_posts / total if total else 0.0,
    )

    logger.info("")
    for label, lat, lng, radius in CASES:
        n = one(
            cur,
            "SELECT count(*) FROM restaurants r WHERE ST_DWithin(r.location, "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s::double precision)",
            (lng, lat, radius),
        )
        logger.info("%-46s 半径内の全店 %10s 件", label, f"{n:,}")
    logger.info("")
    logger.info("  ← 所要時間が右の «半径内の全店» に比例するなら、駆動表を間違えている")
    return with_posts


def restaurants_rows_read(plan):
    """実行計画から «restaurants を読んだ延べ行数» を拾う。

    LATERAL の主キー探索は «loops 回まわって 0〜1 行» なので、
    行数ではなく **loops × rows** で数える（半径に比例するかを見るのが目的）。
    """
    total = 0
    detail = []
    for line in plan:
        s = line.strip()
        if not re.search(r"\bon (restaurants|idx_restaurants_location)\b", s):
            continue
        m = re.search(r"actual time=[\d.]+\.\.[\d.]+ rows=(\d+) loops=(\d+)", s)
        if not m:
            continue
        rows = int(m.group(1)) * int(m.group(2))
        total += rows
        detail.append((s[:110], rows))
    return total, detail


def explain(cur, sql, nparams, params, generic):
    cur.execute("DEALLOCATE ALL")
    cur.execute(f"PREPARE q AS {sql}")
    cur.execute(
        "SET LOCAL plan_cache_mode = %s",
        ("force_generic_plan" if generic else "force_custom_plan",),
    )
    placeholders = ",".join(["%s"] * nparams)
    cur.execute(f"EXPLAIN (ANALYZE, BUFFERS) EXECUTE q({placeholders})", params)
    plan = [row[0] for row in cur.fetchall()]
    exec_ms = None
    for line in plan:
        if line.strip().startswith("Execution Time"):
            exec_ms = float(line.split(":")[1].strip().split(" ")[0])
    return plan, exec_ms


def run_explain(cur, schema, with_posts, full_plan, do_assert):
    section("2. custom plan と generic plan の両方で測る")
    logger.info("custom  = 最初の数回。半径の «値» がプランナから見えている")
    logger.info("generic = Prisma の prepared statement が落ち着く先。値が見えない")
    logger.info("")
    logger.info(
        "判定: **custom / generic の両方**で、restaurants から読む延べ行数が "
        "«投稿を持つ店 %s + limit %s» の %s 倍を超えたら赤",
        f"{with_posts:,}",
        LIMIT,
        ROWS_BUDGET_MULTIPLIER,
    )
    budget = (with_posts + LIMIT) * ROWS_BUDGET_MULTIPLIER

    sql, names = load_sql("search_nearby_restaurants.default")
    nparams = len(names)
    failures = []

    for label, lat, lng, radius in CASES:
        logger.info("")
        logger.info("-" * 72)
        logger.info("## %s", label)
        logger.info("-" * 72)
        params = bind(names, lat, lng, radius, LIMIT)
        for generic in (False, True):
            mode = "generic" if generic else "custom "
            cur.execute("SET LOCAL statement_timeout = '120s'")
            try:
                plan, ms = explain(cur, sql, nparams, params, generic)
            except psycopg2.errors.QueryCanceled:
                cur.connection.rollback()
                cur.execute(f'SET search_path TO "{schema}", extensions')
                logger.info("   %s: ⏱ 120 秒でタイムアウト（= 実用にならない）", mode)
                failures.append(f"{label} / {mode}: timeout")
                continue

            rows, detail = restaurants_rows_read(plan)
            # ⚠️ **custom / generic の両方を判定する。**
            #    #1686 のあと «generic だけ» を見ていたせいで、custom plan が
            #    11〜13 秒のまま «✅» と表示されて見落とした（dev run 33229509189）。
            #    どちらか一方でも半径内を舐めていたら赤にする
            verdict = " ✅" if rows <= budget else "  ❌ 半径内の全店を読んでいる"
            if rows > budget:
                failures.append(
                    f"{label} / {mode.strip()} plan: restaurants を延べ {rows:,} 行 "
                    f"読んでいる（上限 {budget:,} 行）"
                )
            logger.info(
                "   %s: %8.1f ms / restaurants から延べ %s 行%s",
                mode,
                ms if ms is not None else -1,
                f"{rows:,}",
                verdict,
            )
            for text, n in detail:
                logger.info("        %s  => %s 行", text, f"{n:,}")
            if full_plan:
                for line in plan:
                    logger.info("        %s", line)

    section("3. 判定")
    if not failures:
        logger.info(
            "✅ custom / generic のどちらでも «走る行数は半径に依存しない» が保てている"
        )
        return 0
    for f in failures:
        logger.error("❌ %s", f)
    logger.error("")
    logger.error(
        "半径がプランナから見えない書き方へ戻っている。"
        "api/src/v1/restaurants/restaurants.repository.ts の posted CTE のコメントを読むこと。"
    )
    return 1 if do_assert else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument("--full-plan", action="store_true", help="実行計画を全行出す")
    parser.add_argument(
        "--assert",
        dest="do_assert",
        action="store_true",
        help="遅いプランなら終了コード 1 を返す（ラチェットとして使う）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    missing = [
        n
        for n in (
            "search_nearby_restaurants.default.sql",
            "search_nearby_restaurants.default.params.json",
        )
        if not (SQL_DIR / n).exists()
    ]
    if missing:
        logger.error("❌ 計測対象の SQL がない: %s", ", ".join(missing))
        logger.error(
            "   UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "restaurants.order-by-posts-plan  で書き出す"
        )
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
            with_posts = run_counts(cur, args.schema)
            return run_explain(
                cur, args.schema, with_posts, args.full_plan, args.do_assert
            )


if __name__ == "__main__":
    sys.exit(main())
