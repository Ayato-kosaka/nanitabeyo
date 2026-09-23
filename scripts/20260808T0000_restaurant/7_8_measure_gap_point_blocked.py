#!/usr/bin/env python3
"""#1947 合格線に足りない地点の近くで «採れているのに配信していない投稿» を理由別に数える。読み取りのみ。

## なぜこれが要るか

2026-09-23 時点で、合格線（上位 70% の 70%）に足りないのは 25 地点 / 39 店。
そこには **まだ呼んでいない IG handle が 1 つも無い**（`7_5`）。無料の発見経路は
巡回・埋め込み走査・@mention・Foursquare の 4 本とも実測で閉じた。

だが **«集めたのに配信していない投稿»** がまだ残っている。`9_1` は 1 回のビルドで
**カテゴリに絵が無い 27,809 投稿（613 カテゴリ）／店の確からしさ 0.60 未満 6,544 投稿**を
落としている。**これが合格線の 25 地点の近くに落ちているなら、1 コールも使わずに埋まる。**

⚠️ 落としているのは全部 **意図した品質ゲート**である。**ここで «緩める» 提案はしない。**
この script は «どのゲートが、合格線のどこで、何件を止めているか» を数えるだけ。
絵を足せば通るもの（カテゴリの画像）と、緩めないと通らないもの（確からしさ）を分けて出す。

## 数え方

`7_5` が選んだ未達地点の 500m 圏にある店を分母に、その店に紐づく resolve 済み投稿を
**配信できなかった理由**で分類する。理由の判定は `9_1` と同じ式を `common_sns` から借りる。
"""
from __future__ import annotations

import argparse
import importlib.util
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (LATEST_RESOLVED_QUALIFY, MIN_RESTAURANT_CONFIDENCE,  # noqa: E402
                        TABLE_DISH_CATEGORY_IMAGES, TABLE_POST_RAW, TABLE_POST_RESOLVED,
                        TABLE_RESTAURANT_CATALOG, category_with_image_cte_sql,
                        post_store_cte_sql, resolved_store_confidence_sql)

LOGGER = logging.getLogger("7_8")


def _load(fname: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def build_sql(ds: str, dish_ds: str, *, radius_m: int) -> str:
    """未達地点の 500m 圏の店に紐づく投稿を、配信できない理由で数える。"""
    images = f"{dish_ds}.{TABLE_DISH_CATEGORY_IMAGES}"
    return f"""
    WITH pts AS (
      SELECT google_place_id AS pid, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @geo_rid AND google_place_id IN UNNEST(@gap_pts)
      GROUP BY google_place_id
    ),
    store_loc AS (
      SELECT google_place_id, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}` WHERE run_id = @geo_rid
      GROUP BY google_place_id
    ),
    near_store AS (
      SELECT DISTINCT s.google_place_id
      FROM store_loc s JOIN pts p ON ST_DWithin(p.location, s.location, {int(radius_m)})
    ),
    v AS (
      SELECT * FROM `{ds}.{TABLE_POST_RESOLVED}`
      {LATEST_RESOLVED_QUALIFY}
    ),
    {post_store_cte_sql(f"{ds}.{TABLE_POST_RAW}", latest_cte="v")},
    {category_with_image_cte_sql(images)}
    SELECT
      COUNT(*) AS posts_near,
      COUNTIF(v.dish_category_id IS NULL) AS no_category,
      COUNTIF(v.dish_category_id IS NOT NULL
              AND v.dish_category_id NOT IN (SELECT dish_category_id FROM category_with_image)
             ) AS category_without_image,
      COUNT(DISTINCT IF(v.dish_category_id IS NOT NULL
              AND v.dish_category_id NOT IN (SELECT dish_category_id FROM category_with_image),
              v.dish_category_id, NULL)) AS categories_without_image,
      COUNT(DISTINCT IF(v.dish_category_id IS NOT NULL
              AND v.dish_category_id NOT IN (SELECT dish_category_id FROM category_with_image),
              ps.google_place_id, NULL)) AS stores_blocked_by_image,
      COUNTIF(v.dish_category_id IS NOT NULL
              AND v.dish_category_id IN (SELECT dish_category_id FROM category_with_image)
              AND NOT ({resolved_store_confidence_sql()})) AS low_confidence,
      COUNT(DISTINCT IF(v.dish_category_id IS NOT NULL
              AND v.dish_category_id IN (SELECT dish_category_id FROM category_with_image)
              AND NOT ({resolved_store_confidence_sql()}),
              ps.google_place_id, NULL)) AS stores_blocked_by_confidence
    FROM v
    JOIN post_store ps ON ps.post_id = v.post_id
    JOIN near_store n ON n.google_place_id = ps.google_place_id
    """


def main() -> int:
    p = argparse.ArgumentParser(
        description="合格線に足りない地点の近くで «配信していない投稿» を理由別に数える。読み取りのみ")
    p.add_argument("--delivery-run-id", "--catalog-run-id", dest="delivery_run_id", required=True)
    p.add_argument("--gap-top-pct", type=int, default=70)
    p.add_argument("--gap-target-pct", type=int, default=70)
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dish-dataset", default="wikidata_food_graph")
    p.add_argument("--print-sql", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    m75 = _load("7_5_measure_rank_coverage.py", "m75")
    m74 = m75._load_7_4()
    ds = f"{args.project}.{args.dataset}"
    if args.print_sql:
        print(build_sql(ds, f"{args.project}.{args.dish_dataset}", radius_m=m74.RADIUS_M))
        return 0

    from google.cloud import bigquery  # noqa: PLC0415
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    points = m75.select_gap_points(pipeline, delivery_run_id=args.delivery_run_id,
                                   top_pct=args.gap_top_pct, target_pct=args.gap_target_pct,
                                   reachable_only=False)
    LOGGER.info("合格線（上位 %d%% の %d%%）に足りない地点 = %d 件",
                args.gap_top_pct, args.gap_target_pct, len(points))
    if not points:
        raise SystemExit("足りない地点が 0 件（既に達成している）。")

    rows = [dict(r) for r in pipeline.execute(
        build_sql(ds, f"{args.project}.{args.dish_dataset}", radius_m=m74.RADIUS_M), [
            bigquery.ScalarQueryParameter("geo_rid", "STRING", m74.SAMPLE_CATALOG_RUN_ID),
            bigquery.ArrayQueryParameter("gap_pts", "STRING", points),
            # ⚠️ resolved_store_confidence_sql() は @min_conf を使う。束ね忘れると
            #    «Query parameter not found» で落ちる（2026-09-23 に踏んだ）。
            #    閾値の値はここに書かず 9_1 と同じ定数を通す。
            bigquery.ScalarQueryParameter("min_conf", "FLOAT64", MIN_RESTAURANT_CONFIDENCE),
        ])]
    r = rows[0] if rows else {}
    near = int(r.get("posts_near") or 0)
    if not near:
        raise SystemExit(
            "未達地点の 500m 圏に resolve 済みの投稿が 1 件も無い。"
            "**«配信できる余地が無い» ではなく «そもそも集まっていない»** である。")

    LOGGER.info("未達地点の 500m 圏の店に紐づく resolve 済み投稿 = %d 件", near)
    LOGGER.info("  カテゴリが付いていない            : %8d", int(r.get("no_category") or 0))
    LOGGER.info("  **カテゴリに絵が無い**             : %8d 件（%d カテゴリ・**%d 店**）",
                int(r.get("category_without_image") or 0),
                int(r.get("categories_without_image") or 0),
                int(r.get("stores_blocked_by_image") or 0))
    LOGGER.info("  店の確からしさ %.2f 未満          : %8d 件（%d 店）",
                MIN_RESTAURANT_CONFIDENCE,
                int(r.get("low_confidence") or 0),
                int(r.get("stores_blocked_by_confidence") or 0))
    LOGGER.info("")
    LOGGER.info("⚠️ «絵が無い» は **絵を 1 枚足せば通る**（品質ゲートを緩めない）。")
    LOGGER.info("⚠️ «確からしさが足りない» 分を通すのは **品質ゲートを緩めること**で、"
                "オーナー判断の領分である。ここでは数えるだけ。")
    LOGGER.info("⚠️ 店数は «そのゲートで止まっている店» であって、"
                "«通せば合格線に乗る店» ではない（カテゴリが合っているかは別問題）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
