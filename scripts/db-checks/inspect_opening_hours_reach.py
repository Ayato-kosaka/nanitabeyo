#!/usr/bin/env python3
"""#1666 営業時間の行が «検索の候補集合に本当に当たっているか» を確かめる（読み取り専用）。

## なぜ要るか

`explain_opening_status.py --assert` は 2026-09-06 に ✅ を出したが、その中身は
**すべての地点・すべての半径で `restaurant_opening_hours から延べ 0 行`** だった
（[run 34036690111](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34036690111)）。

dev には OSM 由来 100,309 行（13,065 店）と公式サイト由来 1,456 行（150 店）が入っている。
候補集合 1,000 件のうち 1 店も当たらないのは、東京 20km でも起きるとは考えにくい。

> **「軽いから 0 行」なのか「当たらないから 0 行」なのかを、番人は区別していない。**

これは #1898 で直したはずの «測っていないのに緑» と同じ形である。
0 行の理由を切り分けるまで、あの ✅ を «閉じている» の根拠にしてはいけない。

## 出すもの

1. `restaurant_opening_hours` の総行数と、`source` 別・`day_of_week` 別の分布
2. 営業時間を持つ店が **東京駅から近い順 1,000 件**の中に何店あるか
   （＝ 番人が測っている候補集合と同じ切り口）
3. 公式サイト由来の行が **いつ取れたか**（`fetched_at` の分布）

   ⚠️ 2026-09-06 のクロール（run 34022514117 / 3,000 件）は、進捗ログ上
      **1,350 件目で parsed が 1 件**、3,000 件目で 150 件だった。後半だけなら
      約 10.7% で標本 300 件のときの 11.3% と一致する。**前半だけが極端に取れていない。**
      理由が分からないまま «5.0%» を前提に計画を立てないよう、まず実データで
      «本当に後半へ偏っているか» を確かめる。

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# ⚠️ 候補の並び（md5(restaurant_id || seed)）を **写経しない**。
#    写経すると «クローラが歩いた順» と «ここが測る順» が黙ってずれ、
#    「前半が picked over だったか」の答えが嘘になる。本番の SQL をそのまま使う。
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "20260808T0000_restaurant"))

from importlib import import_module  # noqa: E402

_crawler = import_module("6_3_crawl_official_site_hours")
CANDIDATE_SQL = _crawler.CANDIDATE_SQL
# ⚠️ **並びを名指しで取る。** ここが測るのは «md5 の並びの中で何番目か» なので、
#    クローラの既定が変わってもこちらの数字の意味が変わらないようにしてある。
ORDER_BY_SEED = _crawler.ORDER_BY_SEED
CRAWL_SOURCE = _crawler.SOURCE

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 番人が使う候補集合の大きさ（explain_opening_status.KNN_LIMIT と同じ考え方）
KNN_LIMIT = 1000

TOTALS_SQL = """
  SELECT source, count(*) AS rows, count(DISTINCT restaurant_id) AS restaurants
  FROM restaurant_opening_hours
  GROUP BY source
  ORDER BY 2 DESC
"""

# 公式サイト由来の行が «いつ取れたか»。クロールは逐次コミットなので、
# fetched_at の分布がそのまま «いつ parsed できたか» になる。
FETCHED_AT_SQL = """
  SELECT date_trunc('hour', fetched_at) AS hour,
         count(*) AS rows,
         count(DISTINCT restaurant_id) AS restaurants
  FROM restaurant_opening_hours
  WHERE source = 'official_site'
  GROUP BY 1
  ORDER BY 1
"""

# 「前半だけ parsed が出なかった」の答え合わせ。
#
# 2026-09-06 のクロールは同じ `--seed 16662` / `only_missing=True` で 4 回走り、
# うち 2 回は途中で落ちた（run 34004377387 は `26:00` で、run 34014768463 は
# `-9:00` で INSERT が死んだ）。落ちた回が **前半を歩いて成功ぶんを持ち去っている**なら、
# 通した回（run 34022514117 / 08:40〜）の候補リストの前半は
# **既に一度読めなかった店だけ**になり、parsed が出ないのは当たり前になる。
#
# 確かめ方は «並び順の中で何番目か»。落ちた回と通した回で rank の分布が
# 重なっていなければ picked over、重なっていれば別の原因である。
#
# ⚠️ `row_number() OVER ()` は CTE が返す順に振る。CANDIDATE_SQL の ORDER BY を
#    保たせるため CTE を MATERIALIZED にしてある（インライン化されると順が壊れる）。
RANK_SQL = """
  WITH walked AS MATERIALIZED (
{candidate_sql}
  ),
  ordered AS (
    SELECT id, row_number() OVER () AS rank FROM walked
  ),
  got AS (
    SELECT restaurant_id::text AS id, min(fetched_at) AS fetched_at
    FROM restaurant_opening_hours
    WHERE source = %(source)s
    GROUP BY 1
  )
  SELECT
    CASE WHEN g.fetched_at < %(cutoff)s::timestamptz THEN 'crashed' ELSE 'completed' END AS run,
    count(*) AS stores,
    min(o.rank) AS min_rank,
    percentile_disc(0.25) WITHIN GROUP (ORDER BY o.rank) AS p25_rank,
    percentile_disc(0.50) WITHIN GROUP (ORDER BY o.rank) AS median_rank,
    percentile_disc(0.75) WITHIN GROUP (ORDER BY o.rank) AS p75_rank,
    max(o.rank) AS max_rank
  FROM got g
  JOIN ordered o ON o.id = g.id
  GROUP BY 1
  ORDER BY 1
"""

# 同じ並びで 500 件ごとに «読めた店» を数える。上の要約より形が見える。
HISTOGRAM_SQL = """
  WITH walked AS MATERIALIZED (
{candidate_sql}
  ),
  ordered AS (
    SELECT id, row_number() OVER () AS rank FROM walked
  ),
  got AS (
    SELECT restaurant_id::text AS id, min(fetched_at) AS fetched_at
    FROM restaurant_opening_hours
    WHERE source = %(source)s
    GROUP BY 1
  )
  SELECT
    ((o.rank - 1) / 500) * 500 AS bucket,
    count(*) FILTER (WHERE g.fetched_at < %(cutoff)s::timestamptz) AS crashed_runs,
    count(*) FILTER (WHERE g.fetched_at >= %(cutoff)s::timestamptz) AS completed_run
  FROM ordered o
  JOIN got g ON g.id = o.id
  GROUP BY 1
  ORDER BY 1
"""

DOW_SQL = """
  SELECT day_of_week, count(*) AS rows
  FROM restaurant_opening_hours
  GROUP BY day_of_week
  ORDER BY day_of_week
"""

# 東京駅から近い順 KNN_LIMIT 件のうち、営業時間を持つ店が何店あるか。
# ⚠️ 番人と同じ «KNN で候補を絞ってから» の形にする。半径で絞ると別のものを測る。
#
# #1666 【設計】**«いま何店あるか» だけでなく «上限は何店か» も一緒に出す。**
#
# 2026-09-24、東京駅の窓は 26/1,000 だった。この数字だけでは
# «クロールを続ければ埋まるのか、そもそも埋まらないのか» が分からず、
# 「この水準で完了と言えるか」をオーナーへ出せない。上限を決めるのは
#
#   1. **website を持つ店が窓に何店あるか** — 公式サイトで取れる母数。ここが天井
#   2. **source 別の内訳** — OSM が既に稼いでいる分と、クロールで増えた分
#   3. **窓が実際に何メートルまで届いているか** — `--near-radius-m` に渡す値。
#      ⚠️ これを推測で決めると «半径が広すぎて窓の外を歩く» に戻る（+9 しか動かなかった原因）
#
# ⚠️ website の条件は `6_3` の候補条件と**同じ形**で書く。ずれると
#    «母数はあるのにクローラが行かない» が «母数が無い» に見える。
WEBSITE_EXISTS = """
    EXISTS (
      SELECT 1 FROM restaurant_links l
      WHERE l.restaurant_id = c.id
        AND l.kind = 'website'
        AND NULLIF(btrim(l.value), '') IS NOT NULL
        AND l.value ~* '^https?://'
    )
"""

# ⚠️ 距離の式を **ORDER BY へ書き出す**。`ORDER BY 2` のような位置指定にすると
#    KNN インデックスが使われる保証が無く、62 万行で statement timeout に落ちる。
#    そのために位置パラメータ（%s）ではなく **名前付き**にしてある（同じ値を 2 回渡せる）。
_NEAREST = "r.location <-> ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography"

REACH_SQL = f"""
  WITH candidates AS (
    SELECT
      r.id,
      {_NEAREST} AS distance_m
    FROM restaurants r
    ORDER BY {_NEAREST}
    LIMIT {KNN_LIMIT}
  )
  SELECT
    count(*) AS candidates,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh WHERE roh.restaurant_id = c.id
    )) AS with_any_hours,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh
      WHERE roh.restaurant_id = c.id AND roh.day_of_week = %(dow)s
    )) AS with_hours_today,
    count(*) FILTER (WHERE {WEBSITE_EXISTS}) AS with_website,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh
      WHERE roh.restaurant_id = c.id AND roh.source = 'official_site'
    )) AS with_official_site_hours,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh
      WHERE roh.restaurant_id = c.id AND roh.source = 'osm'
    )) AS with_osm_hours,
    -- クロールがまだ当たっていない母数。**次に --limit へ渡す値**
    count(*) FILTER (WHERE {WEBSITE_EXISTS} AND NOT EXISTS (
      SELECT 1 FROM restaurant_opening_hours roh
      WHERE roh.restaurant_id = c.id AND roh.source = 'official_site'
    )) AS website_not_yet_crawled,
    max(c.distance_m)::int AS window_radius_m
  FROM candidates c
"""

POINTS = (
    ("東京駅", 139.7671, 35.6812),
    ("大阪駅", 135.4959, 34.7024),
    ("札幌駅", 141.3507, 43.0686),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    # ⚠️ 2026-09-06 のクロール 4 回はすべてこの seed / この国。変えると別の並びを測る。
    parser.add_argument("--seed", default="16662", help="クロールで使った --seed と同じ値")
    parser.add_argument("--country", default="JP")
    parser.add_argument(
        "--crashed-before",
        default="2026-09-06T08:00:00+00:00",
        help="この時刻より前の fetched_at を «落ちた回» とみなす（既定は 08:40 の回の直前）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import datetime

    import psycopg2

    # 番人と同じ «今日» の出し方（0 = 日曜 … 6 = 土曜）
    dow_today = datetime.date.today().isoweekday() % 7

    result = {"schema": args.schema, "dow_today": dow_today}

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)
            logger.info("今日の day_of_week（0=日曜）: %s", dow_today)

            # #1666 【設計】**1 本が時間切れになっても、取れた分は捨てない。**
            #
            # 2026-09-23、dev でこのスクリプトが «候補の並び» のクエリで
            # `statement timeout` に当たり、**その前に成功していた 3 本ぶんの集計まで
            # 道連れで失われた**（[run 35888800398]）。全部のクエリを先に流してから
            # まとめて表示する作りだったためである。
            #
            # 測りに来たのに «1 本も数字が出ない» のがいちばん困るので、
            # ①各セクションは取れた直後に出す ②時間切れはそのセクションだけ諦める
            # の 2 点に変える。⚠️ 諦めたことは **必ず出力に残す**
            # （黙って欠けると «0 件» と区別が付かない。#1898 と同じ形）。
            failed_sections: list[str] = []

            def run_section(label: str, sql: str, params=None):
                """1 セクションぶんのクエリ。時間切れなら None を返して先へ進む。"""
                try:
                    cur.execute(sql, params)
                    return cur.fetchall()
                except psycopg2.errors.QueryCanceled:
                    # ⚠️ 例外でトランザクションが中断しているので、次のクエリの前に戻す
                    conn.rollback()
                    cur.execute("SET default_transaction_read_only = on")
                    cur.execute(f'SET search_path TO "{args.schema}", extensions')
                    logger.warning("⏱️ %s は statement timeout で取れませんでした", label)
                    failed_sections.append(label)
                    return None

            totals = run_section("source 別の集計", TOTALS_SQL)
            dows = run_section("day_of_week 別の集計", DOW_SQL)
            fetched = run_section("公式サイト由来の取得時刻", FETCHED_AT_SQL)

            # #1666 `near=""` で «全国» のままにする。ここは «クローラが歩く順» を
            # 測る場所なので、エリアで絞ってはいけない（絞ると rank の意味が変わる）。
            candidate_sql = CANDIDATE_SQL.format(
                schema=args.schema, only_missing="", near="", order=ORDER_BY_SEED
            )
            rank_params = {
                "country": args.country,
                "seed": args.seed,
                # 全件に順位を振りたいので LIMIT は実質無制限にする
                "limit": 10_000_000,
                "source": CRAWL_SOURCE,
                "cutoff": args.crashed_before,
            }
            ranks = run_section(
                "候補の並び（rank）", RANK_SQL.format(candidate_sql=candidate_sql), rank_params
            )
            histogram = run_section(
                "候補の並びのヒストグラム",
                HISTOGRAM_SQL.format(candidate_sql=candidate_sql),
                rank_params,
            )

            # ⚠️ ここがこのスクリプトの**主目的**（番人の «0 行 ✅» の切り分け）なので、
            #    上の重いクエリが落ちても必ず試す。1 地点ずつ独立に扱う
            reach = []
            for label, lng, lat in POINTS:
                row = run_section(
                    f"近い順の到達（{label}）",
                    REACH_SQL,
                    {"lng": lng, "lat": lat, "dow": dow_today},
                )
                if row:
                    reach.append((label, *row[0]))

            result["failed_sections"] = failed_sections

    logger.info("")
    logger.info("=" * 78)
    logger.info("# #1666 営業時間の行は、検索の候補集合に当たっているか")
    logger.info("=" * 78)

    logger.info("")
    logger.info("## restaurant_opening_hours（source 別）")
    if totals is None:
        logger.info("  （statement timeout で取れませんでした）")
    result["by_source"] = {}
    for source, rows, restaurants in totals or ():
        logger.info("  %-16s : %10s 行 / %8s 店", source, f"{rows:,}", f"{restaurants:,}")
        result["by_source"][source] = {"rows": rows, "restaurants": restaurants}

    logger.info("")
    logger.info("## day_of_week 別（0=日曜 … 6=土曜）")
    if dows is None:
        logger.info("  （statement timeout で取れませんでした）")
    result["by_dow"] = {}
    for dow, rows in dows or ():
        mark = "  ← 今日" if dow == dow_today else ""
        logger.info("  %s : %10s 行%s", dow, f"{rows:,}", mark)
        result["by_dow"][str(dow)] = rows

    logger.info("")
    logger.info("## 公式サイト由来の行が取れた時刻（1 時間ごと）")
    if fetched is None:
        logger.info("  （statement timeout で取れませんでした）")
    logger.info("   ⚠️ 後半へ極端に偏っていれば、前半で何かが起きていた")
    result["official_site_fetched_at"] = {}
    for hour, rows, restaurants in fetched or ():
        logger.info("  %s : %8s 行 / %6s 店", hour, f"{rows:,}", f"{restaurants:,}")
        result["official_site_fetched_at"][str(hour)] = {
            "rows": rows,
            "restaurants": restaurants,
        }

    logger.info("")
    logger.info("## 候補の並び（md5(restaurant_id || seed)）の何番目で読めたか")
    if ranks is None:
        logger.info("  （statement timeout で取れませんでした）")
    logger.info("   crashed  = 途中で落ちた回（〜07:41）が書いた店")
    logger.info("   completed = 通した回（08:40〜13:25）が書いた店")
    logger.info("   ⚠️ 2 つの rank が重なっていなければ «前半は既に読めなかった店だけ» である")
    result["rank_by_run"] = {}
    for run, stores, mn, p25, med, p75, mx in ranks or ():
        logger.info(
            "  %-10s : %4s 店 / rank min=%s p25=%s 中央=%s p75=%s max=%s",
            run,
            f"{stores:,}",
            f"{mn:,}",
            f"{p25:,}",
            f"{med:,}",
            f"{p75:,}",
            f"{mx:,}",
        )
        result["rank_by_run"][run] = {
            "stores": stores,
            "min": mn,
            "p25": p25,
            "median": med,
            "p75": p75,
            "max": mx,
        }

    logger.info("")
    logger.info("## 同じ並びで 500 件ごとに «読めた店»")
    if histogram is None:
        logger.info("  （statement timeout で取れませんでした）")
    result["rank_histogram"] = {}
    for bucket, crashed, completed in histogram or ():
        logger.info(
            "  %6s-%-6s : 落ちた回 %3s 店 / 通した回 %3s 店",
            f"{bucket:,}",
            f"{bucket + 499:,}",
            crashed,
            completed,
        )
        result["rank_histogram"][str(bucket)] = {
            "crashed_runs": crashed,
            "completed_run": completed,
        }

    logger.info("")
    logger.info("## 近い順 %s 件のうち、営業時間を持つ店", f"{KNN_LIMIT:,}")
    logger.info("   ⚠️ ここが 0 なら、番人の «0 行 ✅» は «当たっていないから 0» である")
    result["reach"] = {}
    for (
        label,
        candidates,
        with_any,
        with_today,
        with_website,
        with_official,
        with_osm,
        not_yet,
        window_radius_m,
    ) in reach:
        logger.info(
            "  %-8s : 候補 %s 件 / 営業時間あり %s 店 / 今日の曜日の行あり %s 店",
            label,
            f"{candidates:,}",
            f"{with_any:,}",
            f"{with_today:,}",
        )
        # 上限と内訳。«続ければ埋まるのか» はこの 3 つで決まる
        logger.info(
            "             内訳: official_site %s 店 / osm %s 店",
            f"{with_official:,}",
            f"{with_osm:,}",
        )
        logger.info(
            "             上限: website を持つ店 %s 店（うち未クロール %s 店）"
            " / この窓の半径 %s m",
            f"{with_website:,}",
            f"{not_yet:,}",
            f"{window_radius_m:,}",
        )
        result["reach"][label] = {
            "candidates": candidates,
            "with_any_hours": with_any,
            "with_hours_today": with_today,
            "with_website": with_website,
            "with_official_site_hours": with_official,
            "with_osm_hours": with_osm,
            "website_not_yet_crawled": not_yet,
            "window_radius_m": window_radius_m,
        }

    logger.info("")
    if result.get("failed_sections"):
        logger.info("⏱️ statement timeout で取れなかったセクション: %s",
                    ", ".join(result["failed_sections"]))
        logger.info("   ⚠️ **これは «0 件» ではない。** 測れなかっただけである")
    logger.info("")
    logger.info("=" * 78)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 78)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
