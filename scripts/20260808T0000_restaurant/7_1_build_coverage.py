#!/usr/bin/env python3
"""#1273 フェーズA成果物: sns_post_resolved(matched) から sns_coverage を作る。

matched（＝resolve が既存店に一意確定した）投稿を、その店の住所（restaurant_catalog.address）から
都道府県×市区町村へ割り当て、異なり google_place_id 数を数える。source_route 内訳と 'all' ロールアップを持つ。
resolve が単一頭脳なので、ここは «集計だけ»。照合や分類はしない。
"""

from __future__ import annotations

import argparse
import logging
import re
from collections import defaultdict

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import TABLE_POST_RAW, TABLE_POST_RESOLVED, TABLE_COVERAGE

LOGGER = logging.getLogger(__name__)

_PREF = ("北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|"
         "神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|"
         "大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|"
         "福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県")
_CITY_RE = re.compile("(" + _PREF + r")(.+?[市区町村])")
_PREF_RE = re.compile("(" + _PREF + ")")


def region_city(address: str | None):
    if not address:
        return None, None
    m = _CITY_RE.search(address)
    if m:
        return m.group(1), m.group(2)
    p = _PREF_RE.search(address)
    return (p.group(1) if p else None), None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="sns_coverage を作る（カテゴリ×市区町村の異なり店）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--resolved-run-id", default=None, help="読む sns_post_resolved の run_id（省略時は --run-id）")
    p.add_argument("--catalog-run-id", default=None, help="住所を引く restaurant_catalog の run_id（省略時は最新）")
    return p.parse_args()


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    for row in pipeline.execute(
        f"SELECT run_id, COUNT(*) c FROM `{pipeline.table('restaurant_catalog')}` "
        f"GROUP BY run_id ORDER BY c DESC LIMIT 1"
    ):
        return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id がありません。")


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    resolved_run_id = args.resolved_run_id or run_id
    pipeline = BigQueryPipeline()
    catalog_run_id = args.catalog_run_id or _latest_catalog_run_id(pipeline)
    now_iso = utc_now().isoformat()

    from google.cloud import bigquery
    # matched な投稿 × 収集ルート × 店住所。post 単位で route を持ち、店住所は catalog から引く。
    # ⚠️ 再解決(非破壊追記)で 1 post に複数 resolve_version 行が並ぶため、**post ごとの最新 version**
    # だけを見る（QUALIFY）。これで «改善後の最新結果» が集計に反映され、古い版は二重計上しない。
    sql = f"""
      WITH latest AS (
        SELECT provider, post_id, status, google_place_id, dish_category_id
        FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        WHERE run_id = @resolved_rid
        QUALIFY ROW_NUMBER() OVER (PARTITION BY provider, post_id ORDER BY resolved_at DESC) = 1
      )
      -- #1273【重要】既知店ルート（柱1/柱4）は «店» を discovery_seed_place_id で確定する。
      -- resolve は投稿URLからキャプションを取り直して店名照合するが、店の «自分の投稿» は
      -- 店名を書かないことが多く、店照合が外れて status!='matched' になる（実測: 柱1 19,396 投稿の
      -- カテゴリ解決済 9,933 のうち matched は 1,044 だけ＝8,889 を取りこぼしていた）。
      -- 収集時点で店は判明している（discovery_seed_place_id、全て in-catalog・46都道府県）ので、
      -- **店はそれを使い、resolve はカテゴリ専用**にする。これで既存データだけでセルが +37%。
      -- discovery_seed_place_id が無い投稿（柱2 インフル・柱3 検索）は従来どおり status='matched' のみ。
      SELECT
        COALESCE(NULLIF(r.discovery_seed_place_id, ''), v.google_place_id) AS google_place_id,
        v.dish_category_id, r.discovery_route AS source_route, c.address
      FROM latest v
      JOIN `{pipeline.table(TABLE_POST_RAW)}` r
        ON r.run_id = @raw_rid AND r.provider = v.provider AND r.post_id = v.post_id
      LEFT JOIN `{pipeline.table('restaurant_catalog')}` c
        ON c.run_id = @crid
       AND c.google_place_id = COALESCE(NULLIF(r.discovery_seed_place_id, ''), v.google_place_id)
      WHERE v.dish_category_id IS NOT NULL
        AND (v.status = 'matched'
             OR (r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''))
    """
    params = [
        bigquery.ScalarQueryParameter("resolved_rid", "STRING", resolved_run_id),
        bigquery.ScalarQueryParameter("raw_rid", "STRING", resolved_run_id),
        bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id),
    ]

    with pipeline.step(run_id, "7_1_build_coverage", parameters={
        "resolved_run_id": resolved_run_id, "catalog_run_id": catalog_run_id,
    }, repo_root=None) as result:
        # (category, region, city, route) -> [distinct place_id set, post_count]
        agg: dict = defaultdict(lambda: [set(), 0])
        for row in pipeline.execute(sql, params):
            region, city = region_city(row["address"])
            cat = row["dish_category_id"]
            place = row["google_place_id"]
            for route in (row["source_route"], "all"):
                k = (cat, region, city, route)
                agg[k][0].add(place)
                agg[k][1] += 1

        rows = [{
            "dish_category_id": cat, "region": region, "city": city, "source_route": route,
            "distinct_store_count": len(places), "post_count": posts,
            "computed_at": now_iso, "run_id": run_id,
        } for (cat, region, city, route), (places, posts) in agg.items()]

        pipeline.delete_run_rows(TABLE_COVERAGE, run_id)
        count = pipeline.load_json_rows(TABLE_COVERAGE, rows) if rows else 0
        result["row_count"] = count
        distinct_all = sum(1 for (_, _, _, route) in agg if route == "all")
        LOGGER.info("sns_coverage に %d セルを投入（category×区の 'all' 内訳=%d）", count, distinct_all)


if __name__ == "__main__":
    main()
