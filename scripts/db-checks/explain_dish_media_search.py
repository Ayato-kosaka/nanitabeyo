#!/usr/bin/env python3
"""#1666 店提案の本体クエリ（`findDishMediaIds`）の実行計画を dev で確かめる（読み取り専用）。

## なぜ要るか

#1818 で「近くの店の候補集合」を共有断片（`nearby-restaurants-cte.ts`）へ切り出したとき、
**営業時間の 2 本だけ EXPLAIN して、本体クエリは確かめていなかった**。
本体はプロダクトで最も重いクエリで、その CTE 構造を触っている。

型検査も jest も «どんな計画で走るか» は見ない。#1629 / #1686 の実績どおり、ここは
**«索引には乗っているのに遅い»** が静かに起きる場所である（半径 5km の東京駅で 9.3 秒）。

## ⚠️ custom / generic の両方を測る

Prisma が投げるのは prepared statement なので、PostgreSQL は数回目から **generic plan**
（パラメータの値を見ないプラン）へ切り替える。半径がプランナから見えなくなると
GIST 索引の見積りが既定値へ落ち、restaurants を駆動表にするプランが選ばれる。
**片方だけ緑を見て «速い» と言わないこと。**

## 測る SQL は写経しない

`scripts/db-checks/sql/dish_media_search.sql` から読む。このファイルは
`api/src/v1/dish-media/dish-media-search-sql.spec.ts` が **実装の組み立て結果と
一致することを機械検査している**ので、写経がずれることは起きない。

道具立て（EXPLAIN の回し方・行数の数え方・測る地点）は `measure_order_by_posts.py`
から import する（同じ判定を 2 箇所に書かない）。

## 読み取り専用である

SELECT と、SELECT に対する PREPARE / EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/explain_dish_media_search.py
    args: --schema dev --assert
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import uuid
from pathlib import Path

import psycopg2

from measure_order_by_posts import (
    CASES,
    REPEATS,
    explain,
    one,
    restaurants_rows_read,
    section,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"
NAME = "dish_media_search"

# 店提案の返却件数。knnCandidateLimit(5) = max(1000, 50*5) = 1000
LIMIT = 5
KNN_LIMIT = max(1000, 50 * LIMIT)
ROWS_BUDGET = KNN_LIMIT * 4

# 実装側の定数（dish-media.repository.ts の GUMBLE_TAU）。params.json の名前と対応する
GUMBEL_TAU = 0.216
# 実在しなくてよい（候補が 0 件でも «どう絞るか» の計画は同じ）
SAMPLE_USER_ID = "11111111-1111-4111-8111-111111111111"
# JP gate を通る実在カテゴリ（yakitori）。dev で最も投稿が多い部類
SAMPLE_CATEGORY_ID = "Q483163"


def load_sql():
    """実装が組み立てた SQL とバインド値の «名前の列» を読む。

    バインド位置は半角疑問符なので $1, $2 … へ直す。
    ⚠️ SQL のコメントに半角疑問符が混ざっていると位置がずれる（jest が個数を検査している）。
    """
    raw = (SQL_DIR / f"{NAME}.sql").read_text(encoding="utf-8").rstrip().rstrip(";")
    names = json.loads((SQL_DIR / f"{NAME}.params.json").read_text(encoding="utf-8"))
    counter = [0]

    def to_positional(_match):
        counter[0] += 1
        return f"${counter[0]}"

    sql = re.sub(r"\?", to_positional, raw)
    if counter[0] != len(names):
        raise SystemExit(
            f"❌ {NAME}: プレースホルダ {counter[0]} 個に対して名前が {len(names)} 個。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 で書き出し直すこと"
        )
    return sql, names


def bind(names, lat, lng, radius):
    """バインド値を «名前の列» の順に並べる。

    ⚠️ 手書きの配列にしないこと。SQL の形を変えると順番も変わり、radius と limit が
       入れ替わったまま «別のクエリを測って» 読み違えた実績がある（#1629）。
    """
    values = {
        "userId": SAMPLE_USER_ID,
        "lat": lat,
        "lng": lng,
        "radius": radius,
        "categoryId": SAMPLE_CATEGORY_ID,
        "limit": LIMIT,
        "knnLimit": KNN_LIMIT,
        "gumbelTau": GUMBEL_TAU,
        "pageSeed": str(uuid.uuid4()),
        # timeSlot 未指定と同じ状態（除外も加点も起きない）。
        # 営業時間つきの経路は explain_opening_status.py が別に測る
        "closedRestaurantIds": [],
        "openRestaurantIds": [],
    }
    return [values[n] for n in names]


def run_counts(cur):
    section("1. 母数（«何行あるから遅い» のかを最初に潰す）")

    total = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total:,}")
    alive = one(cur, "SELECT count(*) FROM dish_media WHERE deleted_at IS NULL")
    logger.info("dish_media（生存）: %s", f"{alive:,}")

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


def run_explain(cur, full_plan, do_assert):
    section("2. custom plan と generic plan の両方で測る")
    logger.info(
        "判定: **両方**で、restaurants から読む延べ行数が KNN 上限 %s の 4 倍 (%s 行) を超えたら赤",
        f"{KNN_LIMIT:,}",
        f"{ROWS_BUDGET:,}",
    )

    sql, names = load_sql()
    failures = []

    for label, lat, lng, radius in CASES:
        logger.info("")
        logger.info("-" * 72)
        logger.info("## %s", label)
        logger.info("-" * 72)
        params = bind(names, lat, lng, radius)

        for generic in (False, True):
            mode = "generic" if generic else "custom "
            cur.execute("SET LOCAL statement_timeout = '120s'")
            runs = []
            timed_out = False
            for _ in range(REPEATS):
                try:
                    plan, t = explain(cur, sql, len(names), params, generic)
                except psycopg2.errors.QueryCanceled:
                    cur.connection.rollback()
                    logger.info("   %s: ⏱ 120 秒でタイムアウト（= 実用にならない）", mode)
                    failures.append(f"{label} / {mode.strip()}: timeout")
                    timed_out = True
                    break
                runs.append(t)
            if timed_out:
                continue

            rows, detail = restaurants_rows_read(plan)
            verdict = " ✅" if rows <= ROWS_BUDGET else "  ❌ 半径内の全店を読んでいる"
            if rows > ROWS_BUDGET:
                failures.append(
                    f"{label} / {mode.strip()} plan: restaurants を延べ {rows:,} 行 "
                    f"読んでいる（上限 {ROWS_BUDGET:,} 行）"
                )
            ms = runs[-1]["exec"]
            logger.info(
                "   %s: %8.1f ms / restaurants から延べ %s 行%s",
                mode,
                ms if ms is not None else -1,
                f"{rows:,}",
                verdict,
            )
            for i, t in enumerate(runs, 1):
                logger.info(
                    "        %d 回目: 実行 %8.1f ms / 計画 %6.1f ms / JIT %s",
                    i,
                    t["exec"] if t["exec"] is not None else -1,
                    t["plan"] if t["plan"] is not None else -1,
                    f'{t["jit"]:.1f} ms' if t["jit"] is not None else "なし",
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
        "候補集合の絞り込みが効いていない。"
        "api/src/v1/restaurants/nearby-restaurants-cte.ts のコメントを読むこと。"
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
        help="半径に比例するプランなら終了コード 1 を返す（ラチェットとして使う）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    missing = [
        f"{NAME}{ext}" for ext in (".sql", ".params.json")
        if not (SQL_DIR / f"{NAME}{ext}").exists()
    ]
    if missing:
        logger.error("❌ 計測対象の SQL がない: %s", ", ".join(missing))
        logger.error(
            "   UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "dish-media-search-sql  で書き出す"
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
            run_counts(cur)
            return run_explain(cur, args.full_plan, args.do_assert)


if __name__ == "__main__":
    sys.exit(main())
