#!/usr/bin/env python3
"""#1273 caption しか無い投稿に «探す地点» を与える（discovery_area_lat/lng の後埋め）。

## なぜこれが要るか（#1812）
resolve が店を探す地点は 2 系統しか無い（`dish-media-imports.service.ts` の
`findRestaurantCandidates`）。

1. 呼び出し側が渡す lat/lng/radius
2. キャプションに «郵便番号付きの住所» が書かれている場合の、その住所

CC WAT 経路（4_9）の投稿はどちらも持たないため `area_not_provided` になり、
キャプションに «南インド料理 【なんどり】 ｜ 東京 荒川区» と店名も区名も書いてあるのに
店が引けない。実測で matched 0.7%（インフルエンサー経路は 20.5%）。

そこで **キャプションに出てくる市区町村名から地点を作って `discovery_area_lat/lng` へ入れる**。
店舗照合そのものは resolve の仕事のままで、ここは «どこを探すか» だけを渡す。

市区町村 → 座標は `restaurant_catalog.address` から作る（外部ジオコーダを足さない）。
実測で 2,376 市区町村ぶんの重心が取れる。

## 誤爆させないための規則
- キャプションに都道府県も書いてあれば、その県の市区町村としてのみ当てる
- 都道府県が無いときは、**全国で 1 県にしか存在しない市区町村名**のときだけ当てる
  （«中央区» «北区» のような多重名は捨てる。間違った地点を渡す方が無害ではない）
"""
from __future__ import annotations

import argparse
import logging

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id
from common_sns import TABLE_POST_RAW

LOGGER = logging.getLogger(__name__)

# 市区町村の重心と、キャプションからの市区町村/都道府県の抜き出し。
# 「北海道」だけ 3 文字なので別扱い、他は «..[都府県]»。
_CITY_CTE = """
  WITH cityc AS (
    SELECT REGEXP_EXTRACT(address, r'(北海道|..[都府県])') pref,
           REGEXP_EXTRACT(address, r'(?:北海道|..[都府県])([^0-9０-９]{2,8}?[市区町村])') city,
           latitude lat, longitude lng
    FROM `{catalog}` WHERE run_id = @crid AND address IS NOT NULL
  ),
  citypt AS (
    SELECT pref, city, AVG(lat) lat, AVG(lng) lng, COUNT(*) n
    FROM cityc WHERE pref IS NOT NULL AND city IS NOT NULL
    GROUP BY pref, city
  ),
  uniqcity AS (
    SELECT city FROM citypt GROUP BY city HAVING COUNT(DISTINCT pref) = 1
  ),
  p AS (
    SELECT post_id,
           REGEXP_EXTRACT(caption, r'(北海道|..[都府県])') cpref,
           REGEXP_EXTRACT_ALL(caption, r'([一-龥ぁ-んァ-ヴー]{1,6}[市区町村])') ccities
    FROM `{raw}`
    WHERE run_id = @rid AND caption IS NOT NULL AND discovery_area_lat IS NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) = 1
  ),
  pc AS (SELECT p.post_id, p.cpref, cname FROM p, UNNEST(p.ccities) AS cname),
  hit AS (
    SELECT pc.post_id, ct.lat, ct.lng,
           ROW_NUMBER() OVER (PARTITION BY pc.post_id
                              ORDER BY LENGTH(pc.cname) DESC, ct.n DESC) rn
    FROM pc
    JOIN citypt ct ON ct.city = pc.cname
    LEFT JOIN uniqcity u ON u.city = pc.cname
    WHERE (pc.cpref IS NOT NULL AND ct.pref = pc.cpref)
       OR (pc.cpref IS NULL AND u.city IS NOT NULL)
  )
"""


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

    # str.format は使えない。SQL 中の正規表現 `{2,8}` を placeholder と誤認して KeyError になる。
    cte = (_CITY_CTE
           .replace("{catalog}", pipeline.table("restaurant_catalog"))
           .replace("{raw}", pipeline.table(TABLE_POST_RAW)))
    params = [
        bigquery.ScalarQueryParameter("rid", "STRING", run_id),
        bigquery.ScalarQueryParameter("crid", "STRING", args.catalog_run_id),
    ]

    count_sql = cte + " SELECT COUNT(*) n FROM hit WHERE rn = 1"
    n = next(iter(pipeline.execute(count_sql, params)))["n"]
    LOGGER.info("地点を当てられる投稿: %d 件（run_id=%s）", n, run_id)
    if args.dry_run:
        return
    if not n:
        return

    update_sql = f"""
      UPDATE `{pipeline.table(TABLE_POST_RAW)}` t
      SET discovery_area_lat = s.lat, discovery_area_lng = s.lng
      FROM ({cte} SELECT post_id, lat, lng FROM hit WHERE rn = 1) s
      WHERE t.run_id = @rid AND t.post_id = s.post_id AND t.discovery_area_lat IS NULL
    """
    pipeline.execute(update_sql, params)
    LOGGER.info("完了: %d 件へ地点を入れました", n)


if __name__ == "__main__":
    main()
