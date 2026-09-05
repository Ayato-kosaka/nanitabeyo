#!/usr/bin/env python3
"""#1666 営業時間の引き上げが «近くの候補集合» に閉じていることを、dev の実 DB で確かめる
（読み取り専用）。

## なぜ要るか

`fetchRestaurantOpeningStatuses` は以前 `restaurant_opening_hours` を **曜日でしか
絞っていなかった**。営業時間データを持つ店が少ないうちは軽いが、#1666 のクローラで
テーブルが埋まると 620,000 店 × 曜日 2 日ぶん ≒ **124 万行を検索 1 回ごとに引き上げる**。
「今は空だから速い」だけの時限爆弾なので、クローラを入れる前に塞いだ（着手前提条件）。

塞いだ形が **本当に索引に乗っているか**は、型検査でも jest でも分からない。ここで測る。

## ⚠️ custom / generic の両方を測る

Prisma が投げるのは prepared statement なので、PostgreSQL は数回目から
**generic plan**（パラメータの値を見ないプラン）へ切り替える。半径がプランナから
見えなくなると GIST 索引の見積りが既定値へ落ち、restaurants を駆動表にする
プランが選ばれる（#1629 / #1686 で実際に踏んだ。東京駅・半径 20km で 9.3 秒 →
generic では 25 秒）。**片方だけ緑を見て «直った» と言わないこと。**

## 測る SQL は写経しない

`scripts/db-checks/sql/opening_status.*.sql` から読む。このファイルは
`api/src/v1/restaurants/opening-status-sql.spec.ts` が **実装の組み立て結果と
一致することを機械検査している**ので、写経がずれることは起きない。

母数・EXPLAIN の道具立ては `measure_order_by_posts.py` から import する
（同じ判定を 2 箇所に書かない。#1629 の SQL 写経事故と同じ理由）。

## 何を判定するか

**restaurants から読む延べ行数が半径に比例しないこと。** 営業時間テーブル自体は
現状ほぼ空なので «読んだ行数» では何も分からない。効いているかどうかは
**候補集合の作り方**（GIST 索引 + KNN + LIMIT）に出る。

## 読み取り専用である

SELECT と、SELECT に対する PREPARE / EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/explain_opening_status.py
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
from pathlib import Path

import psycopg2

# ⚠️ 道具立ては写経しない。EXPLAIN の回し方・行数の数え方・測る地点は
#    measure_order_by_posts.py が正本で、そこを直せばここも一緒に直る。
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

# 店提案の返却件数。knnCandidateLimit(20) = max(1000, 50*20) = 1000
LIMIT = 20
KNN_LIMIT = max(1000, 50 * LIMIT)

# 候補集合は KNN で KNN_LIMIT 件に落ちる。restaurants から読む延べ行数が
# その数倍に収まっていれば «半径に比例していない»。半径内を舐めるプランへ倒れると桁が変わる
ROWS_BUDGET = KNN_LIMIT * 4

QUERIES = ("opening_status.hours", "opening_status.exceptions")

# 曜日・例外日は now から決まる。EXPLAIN では «どの日か» は結果を変えないので固定値でよい
SAMPLE_DOW = (5, 4)
SAMPLE_DATES = ("2026-09-04", "2026-09-03")


def load_sql(name):
    """実装が組み立てた SQL とバインド値の «名前の列» を読む。

    バインド位置は半角疑問符なので $1, $2 … へ直す。
    ⚠️ SQL のコメントに半角疑問符が混ざっていると位置がずれる（jest が個数を検査している）。
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


def bind(names, lat, lng, radius):
    """バインド値を «名前の列» の順に並べる。

    ⚠️ 手書きの配列にしないこと。SQL の形を変えると順番も変わり、
       radius と limit が入れ替わったまま «別のクエリを測って» 読み違えた実績がある。
    """
    values = {
        "lat": lat,
        "lng": lng,
        "radius": radius,
        "knnLimit": KNN_LIMIT,
        "dowToday": SAMPLE_DOW[0],
        "dowYesterday": SAMPLE_DOW[1],
        "dateToday": SAMPLE_DATES[0],
        "dateYesterday": SAMPLE_DATES[1],
    }
    return [values[n] for n in names]


def run_counts(cur):
    section("1. 母数（«何行あるから遅い» のかを最初に潰す）")

    total = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total:,}")

    for table in ("restaurant_opening_hours", "restaurant_hours_exceptions"):
        n = one(cur, f"SELECT count(*) FROM {table}")
        logger.info("%-32s %10s 行", table, f"{n:,}")

    logger.info("")
    logger.info(
        "⚠️ 営業時間テーブルが空のうちは «読んだ行数» では何も分からない。"
        "効いているかどうかは **候補集合の作り方** に出る（下の restaurants の延べ行数）"
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


def run_explain(cur, full_plan, do_assert):
    section("2. custom plan と generic plan の両方で測る")
    logger.info("custom  = 最初の数回。半径の «値» がプランナから見えている")
    logger.info("generic = Prisma の prepared statement が落ち着く先。値が見えない")
    logger.info("")
    logger.info(
        "判定: **両方**で、restaurants から読む延べ行数が KNN 上限 %s の 4 倍 "
        "(%s 行) を超えたら赤",
        f"{KNN_LIMIT:,}",
        f"{ROWS_BUDGET:,}",
    )

    failures = []
    for name in QUERIES:
        sql, names = load_sql(name)
        section(f"2-{QUERIES.index(name) + 1}. {name}")

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
                        failures.append(f"{name} / {label} / {mode.strip()}: timeout")
                        timed_out = True
                        break
                    runs.append(t)
                if timed_out:
                    continue

                rows, detail = restaurants_rows_read(plan)
                verdict = " ✅" if rows <= ROWS_BUDGET else "  ❌ 半径内の全店を読んでいる"
                if rows > ROWS_BUDGET:
                    failures.append(
                        f"{name} / {label} / {mode.strip()} plan: restaurants を延べ "
                        f"{rows:,} 行読んでいる（上限 {ROWS_BUDGET:,} 行）"
                    )
                ms = runs[-1]["exec"]
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
            "✅ custom / generic のどちらでも «営業時間の引き上げは候補集合に閉じている»"
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
        f"{q}{ext}"
        for q in QUERIES
        for ext in (".sql", ".params.json")
        if not (SQL_DIR / f"{q}{ext}").exists()
    ]
    if missing:
        logger.error("❌ 計測対象の SQL がない: %s", ", ".join(missing))
        logger.error(
            "   UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "opening-status-sql  で書き出す"
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
