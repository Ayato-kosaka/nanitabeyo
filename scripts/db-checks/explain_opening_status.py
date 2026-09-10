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
# ⚠️ 数え方の実装は `explain_rows_read.py` が正本。写経しないこと。
from explain_rows_read import (  # noqa: E402
    restaurants_rows_read_with_bound,
    table_rows_read_with_bound,
    verdict_against_budget,
)
from measure_order_by_posts import (
    CASES,
    REPEATS,
    explain,
    one,
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

# ⚠️ **`restaurants` の行数だけでは «閉じている» を主張できない。**
#
# このスクリプトが守りたいのは「営業時間テーブルが埋まっても検索 1 回の重さが増えない」
# だが、上の ROWS_BUDGET は `restaurants` / `idx_restaurants_location` を読んだ行しか
# 数えていない（`restaurants_rows_read` の実装がその 2 つに限っている）。
# つまり **営業時間テーブル側を全件舐めるプランへ倒れても緑のまま**だった。
# «測っていないもの» を «測った» と言わないために、こちらも数えて判定に入れる。
#
# 上限の出し方: 候補は KNN で KNN_LIMIT 件に落ち、曜日は 2 日ぶんしか引かない。
# dev 実測で 1 店あたり約 9.8 行 / 週 = 1 曜日あたり約 1.4 行なので、
# 期待値は KNN_LIMIT × 2 × 1.4 ≒ 2,800 行。ここは «桁が変わったこと» を捕まえるのが
# 目的なので、10 行/曜日 まで許して 7 倍の余裕を置く。
# 半径内を舐めるプランへ倒れると 100 万行の桁になるので、この幅で十分に分かれる。
HOURS_ROWS_BUDGET = KNN_LIMIT * 2 * 10

# 数える対象。QUERIES と 1 対 1 で対応させる（片方だけ増やさないこと）
HOURS_TABLES = {
    "opening_status.hours": "restaurant_opening_hours",
    "opening_status.exceptions": "restaurant_hours_exceptions",
}

QUERIES = ("opening_status.hours", "opening_status.exceptions")


def sample_bind_values():
    """EXPLAIN に流す «今日と昨日» を作る。

    ⚠️ **ここを消さないこと。** #1898 で私はこの 2 つの定数を消してしまい、
       `bind()` が `NameError: SAMPLE_DOW` で落ちるようにした。つまり
       «営業時間テーブルが埋まっても重くならない» を守るはずの番人が、
       **測る前に落ちる**状態で main に入っていた（run 34035482145 で発覚）。
       «測っていなかった» を直した PR で、«動かない» にしてしまっていた。

    `day_of_week` は **0 = 日曜 … 6 = 土曜**（PostgreSQL の `EXTRACT(DOW)` と同じ並び。
    `scripts/20260808T0000_restaurant/osm_opening_hours.py` が正本）。

    ⚠️ 日付を固定値で埋め込まないこと。過去の日付にすると
       `restaurant_hours_exceptions` 側が 1 行も当たらず、
       **«例外テーブルを読まないプラン» を測って «軽い» と誤読する**。
    """
    import datetime

    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    # isoweekday(): 月=1 … 日=7。%7 で 日=0 … 土=6 になり EXTRACT(DOW) と揃う
    return {
        "dowToday": today.isoweekday() % 7,
        "dowYesterday": yesterday.isoweekday() % 7,
        "dateToday": today.isoformat(),
        "dateYesterday": yesterday.isoformat(),
    }


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
        **sample_bind_values(),
    }
    missing = [n for n in names if n not in values]
    if missing:
        # ⚠️ ここで «名前が足りない» を明示的に落とす。KeyError のまま投げると
        #    «番人が壊れている» のか «SQL が変わった» のか読み分けられない。
        raise SystemExit(
            f"❌ バインド値が用意できていない名前があります: {missing}\n"
            "   SQL のバインド名を増やしたなら sample_bind_values() か bind() へ足すこと。"
        )
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
    # 丸めで «0 行» になった節。ここが空でない限り «閉じている» とは言わない
    measured_floor = []
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

                rows, rows_upper, detail, _ = restaurants_rows_read_with_bound(plan)
                r_state = verdict_against_budget(rows, rows_upper, ROWS_BUDGET)
                if r_state == "within":
                    verdict = " ✅"
                elif r_state == "over":
                    verdict = "  ❌ 半径内の全店を読んでいる"
                    failures.append(
                        f"{name} / {label} / {mode.strip()} plan: restaurants を延べ "
                        f"{rows:,} 行読んでいる（上限 {ROWS_BUDGET:,} 行）"
                    )
                else:
                    verdict = f"  ⚠️ 判定できない（丸めの上界 {rows_upper:,} 行 > 上限）"

                # ⚠️ 営業時間テーブル側も数える（上の HOURS_ROWS_BUDGET の注記）
                table = HOURS_TABLES[name]
                h_rows, h_upper, h_detail, h_floor_loops = table_rows_read_with_bound(plan, table)
                h_state = verdict_against_budget(h_rows, h_upper, HOURS_ROWS_BUDGET)

                # ⚠️ **0 行を «軽い» の根拠にしない。**
                #    rows= は 1 loop あたりの平均が整数へ丸められた値なので、
                #    1 loop あたり 0.5 行未満だと必ず 0 になる（explain_rows_read の注記）。
                #    営業時間テーブルは «候補 1,000 件のうち十数件しか当たらない» ので、
                #    まさにこの範囲に落ちる。上限は超えていないが、測れてもいない。
                if h_state == "within":
                    # 丸めを最大に見積もっても上限内。**下界が 0 でも、これは根拠になる。**
                    h_verdict = f" ✅（丸めの上界でも {h_upper:,} 行 ≤ {HOURS_ROWS_BUDGET:,} 行）"
                elif h_state == "over":
                    h_verdict = "  ❌ 候補集合の外まで読んでいる"
                    failures.append(
                        f"{name} / {label} / {mode.strip()} plan: {table} を延べ "
                        f"{h_rows:,} 行読んでいる（上限 {HOURS_ROWS_BUDGET:,} 行）"
                    )
                else:
                    h_verdict = (
                        f"  ⚠️ 判定できない（丸めの上界 {h_upper:,} 行 > 上限 "
                        f"{HOURS_ROWS_BUDGET:,} 行。loops={h_floor_loops:,}）"
                    )
                    measured_floor.append(f"{name} / {label} / {mode.strip()} plan: {table}")

                ms = runs[-1]["exec"]
                logger.info(
                    "   %s: %8.1f ms / restaurants から延べ %s 行%s / %s から延べ %s 行%s",
                    mode,
                    ms if ms is not None else -1,
                    f"{rows:,}",
                    verdict,
                    table,
                    f"{h_rows:,}",
                    h_verdict,
                )
                for text, n in detail + h_detail:
                    logger.info("        %s  => %s 行", text, f"{n:,}")
                if full_plan:
                    for line in plan:
                        logger.info("        %s", line)

    section("3. 判定")
    if measured_floor:
        logger.info(
            "⚠️ 営業時間テーブル側は **判定できていない**（丸めの上界が上限を超える節が"
            " %d 件）。丸めがどちらへ転ぶかで結論が変わるため、«閉じている» とは書けない:",
            len(measured_floor),
        )
        for line in measured_floor:
            logger.info("   - %s", line)
        logger.info("")

    if not failures:
        if measured_floor:
            logger.info(
                "✅ restaurants 側は候補集合に閉じている。"
                "⚠️ 営業時間テーブル側は上限を超えていないだけで、**確かめられていない**"
            )
        else:
            logger.info(
                "✅ custom / generic のどちらでも «営業時間の引き上げは候補集合に閉じている»"
                "（restaurants 側・営業時間テーブル側の **両方**で確認した）"
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
