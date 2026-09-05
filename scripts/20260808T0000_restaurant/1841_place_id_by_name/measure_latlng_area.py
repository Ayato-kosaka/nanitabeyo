#!/usr/bin/env python3
"""#1273 «市区町村がキャプションに書いていない» 投稿を、収集時の座標で救えるかを測る。

4_18 が店名を採れても捨てている理由の 1/3 は «地点が分からない» である
（実測 2026-09-05: 店名を採れた 96,846 件に対し、地点なしで捨てた 47,464 件）。
`sns_post_raw.discovery_area_lat/lng`（収集時に探した地点）を市区町村へ引き直せば
救えるが、**その座標は «投稿の店の場所» ではなく «探した場所»** なので、当てると
別の市の同名店を掴む危険がある。

そこで «キャプションに市区町村が書いてある投稿» だけを使い、
**座標から引いた市区町村が、書いてある市区町村と一致するか**を数える。
一致率がそのまま「座標で代用したときの当たり方」の上限になる。Google へは 1 本も投げない。
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common_sns import (TABLE_POST_RAW, TABLE_POST_RESOLVED, build_city_bbox_index,  # noqa: E402
                        build_city_index, city_from_text, city_index_sql)
from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

SQL = """
  WITH r AS (
    SELECT post_id, ANY_VALUE(caption) caption, ANY_VALUE(discovery_query) dq,
           ANY_VALUE(discovery_seed_place_id) seed,
           MAX(discovery_area_lat) lat, MAX(discovery_area_lng) lng
    FROM `__RAW__` WHERE caption IS NOT NULL GROUP BY post_id
  ), v AS (
    SELECT post_id, ANY_VALUE(google_place_id) gp FROM `__RESOLVED__` GROUP BY post_id
  )
  SELECT r.post_id, r.caption, r.dq, r.lat, r.lng
  FROM r LEFT JOIN v USING (post_id)
  WHERE (r.seed IS NULL OR r.seed = '') AND (v.gp IS NULL OR v.gp = '')
    AND r.lat IS NOT NULL AND r.lng IS NOT NULL
  ORDER BY r.post_id
"""


def build_grid(boxes: dict) -> dict:
    """0.1 度のマス目 → そのマスに掛かる市区町村。2,089 件を毎回総当たりしないため。"""
    grid: dict[tuple[int, int], list] = {}
    for pair, box in boxes.items():
        lat_lo, lng_lo, lat_hi, lng_hi = box
        for i in range(int(lat_lo * 10), int(lat_hi * 10) + 1):
            for j in range(int(lng_lo * 10), int(lng_hi * 10) + 1):
                grid.setdefault((i, j), []).append((pair, box))
    return grid


def nearest_city(lat: float, lng: float, grid: dict) -> tuple[tuple[str, str] | None, float]:
    """矩形の中に入る市区町村。複数当たったら中心が近い方。km も返す。"""
    best, best_km = None, float("inf")
    for pair, (lat_lo, lng_lo, lat_hi, lng_hi) in grid.get((int(lat * 10), int(lng * 10)), ()):
        if not (lat_lo <= lat <= lat_hi and lng_lo <= lng <= lng_hi):
            continue
        clat, clng = (lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2
        km = math.hypot((lat - clat) * 111.32, (lng - clng) * 111.32 * math.cos(math.radians(lat)))
        if km < best_km:
            best, best_km = pair, km
    return best, best_km


def main() -> None:
    configure_logging()
    p = argparse.ArgumentParser()
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--limit", type=int, default=120000)
    args = p.parse_args()

    pipeline = BigQueryPipeline()
    from google.cloud import bigquery
    rows = list(pipeline.execute(
        city_index_sql(pipeline.table("restaurant_catalog")),
        [bigquery.ScalarQueryParameter("crid", "STRING", args.catalog_run_id)]))
    by_pair, uniq = build_city_index([dict(r) for r in rows])
    boxes, pref_of_unique_city = build_city_bbox_index([dict(r) for r in rows])
    grid = build_grid(boxes)

    sql = (SQL.replace("__RAW__", pipeline.table(TABLE_POST_RAW))
           .replace("__RESOLVED__", pipeline.table(TABLE_POST_RESOLVED)))
    n = agree = disagree = no_text_city = no_box = 0
    for post in pipeline.execute(sql):
        n += 1
        if n > args.limit:
            break
        from_box, _ = nearest_city(post["lat"], post["lng"], grid)
        if from_box is None:
            no_box += 1
            continue
        text = (city_from_text(post["caption"] or "", by_pair, uniq)
                or city_from_text(post["dq"] or "", by_pair, uniq))
        if text is None:
            no_text_city += 1
            continue
        pref, city = text
        pref = pref or pref_of_unique_city.get(city)
        if (pref, city) == from_box:
            agree += 1
        else:
            disagree += 1
    judged = agree + disagree
    print(f"座標つきの未確定投稿: {n}")
    print(f"  矩形に入る市区町村が無い: {no_box}")
    print(f"  キャプションに市区町村が無い（= 座標で救える候補）: {no_text_city}")
    print(f"  両方ある: {judged} / 一致 {agree} / 不一致 {disagree}"
          f" → 一致率 {100.0 * agree / max(judged, 1):.1f}%")


if __name__ == "__main__":
    main()
