#!/usr/bin/env python3
"""#1273 既に書き込んだ投稿へ «探す地点» を後から入れる（discovery_area_lat/lng の後埋め）。

## なぜこれが要るか（#1812）
resolve が店を探せる地点は 2 つしか無い（`dish-media-imports.service.ts` の
`findRestaurantCandidates`）。呼び出し側が渡す lat/lng/radius か、キャプション中の
«郵便番号付き住所» を座標化したもの。どちらも無ければ候補は空で返る。

経路ごとの実測（住所らしき記述を持つ caption の割合 / matched）:
- 柱2 インフルエンサー 43.7% / 20.5%
- 柱1 店アカ 19.2%
- 柱4 CC WAT **0.6% / 0.7%**

CC のキャプションは «南インド料理 【なんどり】 ｜ 東京 荒川区» のように店名も区名も
書いてあるのに、郵便番号付きの住所ではないため地点が作れず `area_not_provided` になっていた。
店が引けないのはデータが悪いからではなく、探す地点を渡していなかったからである。

## 判定は写経しない
市区町村の抜き出しと «どの市区町村と見なすか» の規則は `common_sns.area_from_text` が唯一の正。
新しく採る投稿は 4_9 が収集時に同じ関数で地点を入れる。このスクリプトは
**地点を入れずに書き込んでしまった既存の行**を後から直すためのものである。

## 使い方（db-script-run.yml）
  args: --run-id sns-2026-09-04-inflcap
"""
from __future__ import annotations

import argparse
import logging

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id
from common_sns import (TABLE_POST_RAW, area_from_text, build_city_index, city_index_sql)

LOGGER = logging.getLogger(__name__)
CHUNK = 5000  # 1 回の UPDATE に載せる件数（配列パラメータのサイズを抑える）


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="caption の市区町村名から discovery_area_lat/lng を埋める")
    p.add_argument("--run-id", default=None, help="対象の sns_post_raw.run_id")
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--dry-run", action="store_true", help="何件埋まるかだけ数える")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery

    by_pair, uniq = build_city_index(pipeline.execute(
        city_index_sql(pipeline.table("restaurant_catalog")),
        [bigquery.ScalarQueryParameter("crid", "STRING", args.catalog_run_id)]))
    LOGGER.info("市区町村 %d 件（うち全国で一意 %d 件）", len(by_pair), len(uniq))

    posts = list(pipeline.execute(
        f"""SELECT post_id, caption FROM `{pipeline.table(TABLE_POST_RAW)}`
            WHERE run_id = @rid AND caption IS NOT NULL AND discovery_area_lat IS NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) = 1""",
        [bigquery.ScalarQueryParameter("rid", "STRING", run_id)]))
    LOGGER.info("地点の無い投稿 %d 件を見ます", len(posts))

    hits = []
    for p in posts:
        area = area_from_text(p["caption"], by_pair, uniq)
        if area:
            hits.append({"post_id": p["post_id"], "lat": area[0], "lng": area[1]})
    LOGGER.info("地点を当てられる投稿: %d 件（%.1f%%）", len(hits),
                100.0 * len(hits) / max(len(posts), 1))
    if args.dry_run or not hits:
        return

    # 構造体配列パラメータは扱いが面倒なので、3 本の平行な配列で渡し、添字で組み直す。
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
        params = [
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ArrayQueryParameter("pids", "STRING", [h["post_id"] for h in chunk]),
            bigquery.ArrayQueryParameter("lats", "FLOAT64", [h["lat"] for h in chunk]),
            bigquery.ArrayQueryParameter("lngs", "FLOAT64", [h["lng"] for h in chunk]),
        ]
        pipeline.execute(sql, params)
        done += len(chunk)
        LOGGER.info("  %d/%d 件へ地点を入れました", done, len(hits))
    LOGGER.info("完了: %d 件", done)


if __name__ == "__main__":
    main()
