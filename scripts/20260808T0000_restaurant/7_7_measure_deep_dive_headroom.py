#!/usr/bin/env python3
"""#1947 «もう呼んだ良いアカウントを、もっと深く掘ったら店は増えるか» を測る。読み取りのみ。

## なぜこれが要るか

2026-09-22 の実測で、配信店の単価はアカウントの種類で 66〜170 倍違うと分かった
（influencer 40.92 / store_branch 0.62 / unknown 0.24 店/アカ）。ところが influencer を
**補充する道は 2 本とも塞がった**（検索＝SERPER 無料枠切れ / @mention＝実測で否定）。

残る手は «新しいアカウントを探す» ではなく **«既に良いと分かっているアカウントを深く掘る»**。
収集は `--limit-per-account 50` で頭を打っており、手作り一覧の平均投稿数は 193.7 だった。
**上限で切られたぶんが取り残されている可能性がある。**

⚠️ ただし «投稿を増やす» と «異なり店が増える» は別物である。同じ店を何度も投稿している
アカウントなら、深く掘っても KPI は 1 ミリも動かない。**掘る前にここで測る。**

## 測り方

呼んだアカウントを **集めた投稿数の帯**で層別し、帯ごとの «1 アカウントあたりの異なり配信店»
を出す。帯が上がっても店が増えないなら、深掘りは無駄である。

⚠️ これは観察であって実験ではない（«投稿が多い» と «良いアカウント» は交絡している）。
**同じ帯の中で account_type を分けて見る**ことで交絡をいくらか剥がす。
それでも因果は言えないので、判断は «伸びしろがありそうか» までに留める。
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (PROVIDER_INSTAGRAM, TABLE_DISH_MEDIA_CATALOG,  # noqa: E402
                        TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT)

LOGGER = logging.getLogger("7_7")

#: 収集の `--limit-per-account` は 50 が既定。50 ちょうどの帯が «上限で切られた» 群である。
BUCKETS = ((1, 10), (11, 25), (26, 49), (50, 50), (51, 100), (101, 200), (201, 10 ** 9))


def build_sql(ds: str) -> str:
    when = "\n".join(
        f"        WHEN posts BETWEEN {lo} AND {hi} THEN '{lo}-{hi if hi < 10**9 else ''}'"
        for lo, hi in BUCKETS)
    return f"""
    WITH cat AS (
      SELECT DISTINCT external_content_id AS post_id, google_place_id
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` WHERE run_id = @cat_rid
    ),
    raw AS (
      SELECT account_id AS handle, post_id
      FROM `{ds}.{TABLE_POST_RAW}` WHERE account_id IS NOT NULL
    ),
    typ AS (
      SELECT handle, account_type FROM (
        SELECT handle, account_type,
               ROW_NUMBER() OVER (PARTITION BY handle ORDER BY discovered_at, run_id) AS rn
        FROM `{ds}.{TABLE_SOURCE_ACCOUNT}`
        WHERE provider = @prov AND handle IS NOT NULL
      ) WHERE rn = 1
    ),
    per AS (
      SELECT r.handle,
             COUNT(DISTINCT r.post_id) AS posts,
             COUNT(DISTINCT c.google_place_id) AS stores
      FROM raw r LEFT JOIN cat c ON c.post_id = r.post_id
      GROUP BY r.handle
    )
    SELECT
      CASE
{when}
        ELSE '(その他)' END AS bucket,
      IFNULL(t.account_type, '(不明)') AS account_type,
      COUNT(*) AS accounts,
      SUM(p.posts) AS posts,
      SUM(p.stores) AS stores,
      COUNTIF(p.stores > 0) AS accounts_with_store
    FROM per p LEFT JOIN typ t USING (handle)
    GROUP BY bucket, account_type
    ORDER BY account_type, bucket
    """


def report(rows: list[dict]) -> None:
    order = {f"{lo}-{hi if hi < 10 ** 9 else ''}": i for i, (lo, hi) in enumerate(BUCKETS)}
    LOGGER.info("%-12s %-14s %9s %10s %9s %10s %10s",
                "account_type", "集めた投稿数", "アカウント", "投稿", "配信店", "店/アカ", "店が付いた率")
    for r in sorted(rows, key=lambda x: (x["account_type"], order.get(x["bucket"], 99))):
        acc = int(r["accounts"] or 0)
        LOGGER.info("%-12s %-14s %9d %10d %9d %10.2f %9.1f%%",
                    r["account_type"], r["bucket"], acc, int(r["posts"] or 0),
                    int(r["stores"] or 0), (int(r["stores"] or 0) / acc) if acc else 0.0,
                    100.0 * int(r["accounts_with_store"] or 0) / acc if acc else 0.0)
    LOGGER.info("")
    LOGGER.info("読み方: 帯が上がるほど «店/アカ» が伸びるなら、深掘り（--limit-per-account を上げる）"
                "に伸びしろがある。横ばいなら、同じ店を何度も投稿しているだけで KPI は動かない。")
    LOGGER.info("⚠️ これは観察であって実験ではない（«投稿が多い» と «良いアカウント» は交絡する）。"
                "断定するなら同じアカウントを深く掘り直す A/B が要る。")
    LOGGER.info("⚠️ «50-» の帯が «上限で切られた» 群。ここに厚みがあるほど取り残しが大きい。")


def main() -> int:
    p = argparse.ArgumentParser(description="深掘りの伸びしろを測る。読み取りのみ")
    p.add_argument("--delivery-run-id", "--catalog-run-id", dest="delivery_run_id", required=True)
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--print-sql", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    sql = build_sql(f"{args.project}.{args.dataset}")
    if args.print_sql:
        print(sql)
        return 0

    from google.cloud import bigquery  # noqa: PLC0415
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    rows = [dict(r) for r in pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
        bigquery.ScalarQueryParameter("cat_rid", "STRING", args.delivery_run_id),
    ])]
    if not rows or not any(int(r["stores"] or 0) for r in rows):
        raise SystemExit(
            f"配信カタログ run_id={args.delivery_run_id!r} に紐づく投稿が 1 件も無い。"
            "測定不能であって «伸びしろ 0» ではない。")
    report(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
