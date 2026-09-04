#!/usr/bin/env python3
"""#1273 «そのアカウントが普段いる場所» を、地点の無い投稿へ後から入れる（後埋め・第2段）。

## なぜこれが要るか（#1812）
resolve が店を探せる地点は 2 つしか無い（`dish-media-imports.service.ts` の
`findRestaurantCandidates`）。呼び出し側の lat/lng/radius か、キャプション中の
«郵便番号付き住所» の座標。どちらも無ければ候補は空で返る（`area_not_provided`）。

4_11 はキャプション/クエリの **文字列**から市区町村を採る。しかし IG のキャプションは
«美味しかった〜🍜» のように地名を一切書かないものが多く、4_11 を通した後でも
inflcap は 15% しか地点が入らなかった。実測で **カテゴリは判定できたのに地点が無いために
落ちている投稿が embcap 27,246 件 / inflcap 26,416 件**あり、これは既に IG の枠を
使って取得済みの投稿が丸ごと死んでいることを意味する。

## 何を根拠に地点を決めるか
**同じアカウントが別の投稿で確定させた店の座標**を使う。飲食アカウントは行動範囲が狭い。
実測（matched が 2 件以上ある 1,960 アカウント）:

| 自分の matched 店の中央値距離 | アカウント数 | 割合 |
| --- | --- | --- |
| 3km 未満 | 1,629 | 83% |
| 3〜10km | 134 | 7% |
| 10〜30km | 125 | 6% |
| 30km 以上 | 72 | 4% |

83% が半径 3km に収まる。つまり «このアカウントの他の投稿が指した店の重心» は、
そのアカウントの地点として十分な精度がある。

## 誤爆しない理由
地点はあくまで «探す範囲» であって «答え» ではない。範囲が外れていれば、その中に
名前の合う店が無いので resolve は候補を返さず、今と同じ «店が付かない» に落ちるだけである
（fail-closed）。間違った店が付くことはない。

## 使い方（db-script-run.yml）
  args: --run-id sns-2026-09-04-embcap
  args: --run-id sns-2026-09-04-inflcap --dry-run
"""
from __future__ import annotations

import argparse
import logging

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id
from common_sns import TABLE_POST_RAW, TABLE_POST_RESOLVED

LOGGER = logging.getLogger(__name__)
CHUNK = 5000  # 1 回の UPDATE に載せる件数（配列パラメータのサイズを抑える）

# 重心を «そのアカウントの地点» と見なしてよい散らばりの上限。上の実測表で 96% が入る。
MAX_MEDIAN_SPREAD_M = 30000
# 重心を作るのに要る matched 投稿の最小数。1 件だとその 1 件の店そのものになり、
# 別の店を探す手がかりにならない（同じ店を再度引くだけ）ので 2 件以上を要求する。
MIN_ANCHORS = 2


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="アカウントの matched 店の重心から discovery_area_lat/lng を埋める")
    p.add_argument("--run-id", default=None, help="対象の sns_post_raw.run_id")
    p.add_argument("--max-spread-m", type=int, default=MAX_MEDIAN_SPREAD_M,
                   help="重心を採用するアカウントの散らばり上限（中央値距離, m）")
    p.add_argument("--min-anchors", type=int, default=MIN_ANCHORS,
                   help="重心を作るのに要る matched 投稿の最小数")
    p.add_argument("--dry-run", action="store_true", help="何件埋まるかだけ数える")
    return p.parse_args()


def _anchor_sql(pipeline: BigQueryPipeline) -> str:
    """アカウントごとの «matched 店の重心» と «散らばり（中央値距離）» を出す。

    重心は run をまたいで集める（どの経路で matched したかは問わない）。同じ post_id が
    複数回 resolve されている（再実行）ので、最新の 1 行だけを見る。
    """
    return f"""
      WITH latest AS (
        SELECT post_id, status, google_place_id
        FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY resolved_at DESC) = 1
      ),
      anchors AS (
        SELECT r.account_id AS handle, c.latitude AS lat, c.longitude AS lng
        FROM `{pipeline.table(TABLE_POST_RAW)}` r
        JOIN latest res ON res.post_id = r.post_id AND res.status = 'matched'
        JOIN `{pipeline.table('restaurant_catalog')}` c ON c.google_place_id = res.google_place_id
        WHERE r.account_id IS NOT NULL AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      ),
      agg AS (
        SELECT handle, COUNT(*) AS n,
               ST_CENTROID_AGG(ST_GEOGPOINT(lng, lat)) AS ctr,
               ARRAY_AGG(STRUCT(lat, lng)) AS pts
        FROM anchors GROUP BY handle
        HAVING n >= @min_anchors
      )
      SELECT handle, n,
             ST_Y(ctr) AS lat, ST_X(ctr) AS lng,
             (SELECT APPROX_QUANTILES(ST_DISTANCE(ST_GEOGPOINT(p.lng, p.lat), ctr), 100)[OFFSET(50)]
              FROM UNNEST(pts) p) AS median_dist_m
      FROM agg
    """


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery

    rows = list(pipeline.execute(_anchor_sql(pipeline), [
        bigquery.ScalarQueryParameter("min_anchors", "INT64", int(args.min_anchors)),
    ]))
    centroid = {r["handle"]: (r["lat"], r["lng"]) for r in rows
                if r["median_dist_m"] is not None and r["median_dist_m"] <= args.max_spread_m}
    LOGGER.info("重心を作れたアカウント %d 件（うち散らばり %dm 以内で採用 %d 件）",
                len(rows), args.max_spread_m, len(centroid))

    posts = list(pipeline.execute(
        f"""SELECT post_id, account_id
            FROM `{pipeline.table(TABLE_POST_RAW)}`
            WHERE run_id = @rid AND discovery_area_lat IS NULL AND account_id IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) = 1""",
        [bigquery.ScalarQueryParameter("rid", "STRING", run_id)]))
    LOGGER.info("地点が無い投稿 %d 件を見ます", len(posts))

    hits = [{"post_id": p["post_id"], "lat": centroid[p["account_id"]][0],
             "lng": centroid[p["account_id"]][1]}
            for p in posts if p["account_id"] in centroid]
    LOGGER.info("アカウントの重心を当てられる投稿: %d 件（%.1f%%）", len(hits),
                100.0 * len(hits) / max(len(posts), 1))
    if args.dry_run:
        return

    sql = f"""
      UPDATE `{pipeline.table(TABLE_POST_RAW)}` t
      SET discovery_area_lat = s.lat, discovery_area_lng = s.lng
      FROM (
        SELECT @pids[OFFSET(o)] AS post_id, @lats[OFFSET(o)] AS lat, @lngs[OFFSET(o)] AS lng
        FROM UNNEST(GENERATE_ARRAY(0, ARRAY_LENGTH(@pids) - 1)) o
      ) s
      WHERE t.run_id = @rid AND t.post_id = s.post_id AND t.discovery_area_lat IS NULL
    """
    done = 0
    for i in range(0, len(hits), CHUNK):
        chunk = hits[i:i + CHUNK]
        pipeline.execute(sql, [
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ArrayQueryParameter("pids", "STRING", [h["post_id"] for h in chunk]),
            bigquery.ArrayQueryParameter("lats", "FLOAT64", [h["lat"] for h in chunk]),
            bigquery.ArrayQueryParameter("lngs", "FLOAT64", [h["lng"] for h in chunk]),
        ])
        done += len(chunk)
        LOGGER.info("  %d/%d 件へ地点を入れました", done, len(hits))
    LOGGER.info("アカウント重心による地点の後埋め完了: %d 件", done)


if __name__ == "__main__":
    main()
