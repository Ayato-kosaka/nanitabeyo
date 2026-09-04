#!/usr/bin/env python3
"""#1273 フェーズB: 店が判明している ready 部分集合を sns_dish_media_catalog に組む（BQ→BQ）。

sns_post_resolved と sns_post_raw(canonical_url) を突き合わせ、
pg へ配信できる «確定行» を row_hash 付きで作る。pg には触れない（9_2 が触る）。
"""

from __future__ import annotations

import argparse
import logging

from pipeline_common import (
    BigQueryPipeline, configure_logging, require_run_id, utc_now, stable_record_hash,
)
from common_sns import (
    PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_POST_RESOLVED, TABLE_DISH_MEDIA_CATALOG,
    STORE_ID_SQL, STORE_KNOWN_SQL,
)

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="matched の ready 行を sns_dish_media_catalog に組む")
    p.add_argument("--run-id", default=None)
    p.add_argument("--resolved-run-id", default=None, help="読む resolved/raw の run_id（省略時 --run-id）")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    src_run_id = args.resolved_run_id or run_id
    pipeline = BigQueryPipeline()
    now_iso = utc_now().isoformat()

    from google.cloud import bigquery
    sql = f"""
      SELECT v.post_id, {STORE_ID_SQL} AS google_place_id, v.dish_category_id,
             ANY_VALUE(r.canonical_url) AS canonical_url
      FROM `{pipeline.table(TABLE_POST_RESOLVED)}` v
      JOIN `{pipeline.table(TABLE_POST_RAW)}` r
        ON r.run_id = @src AND r.provider = v.provider AND r.post_id = v.post_id
      WHERE v.run_id = @src AND {STORE_KNOWN_SQL}
        AND {STORE_ID_SQL} IS NOT NULL AND v.dish_category_id IS NOT NULL
      GROUP BY v.post_id, google_place_id, v.dish_category_id
    """
    params = [bigquery.ScalarQueryParameter("src", "STRING", src_run_id)]

    with pipeline.step(run_id, "9_1_build_sns_dish_media_catalog",
                       parameters={"resolved_run_id": src_run_id}, repo_root=None) as result:
        rows = []
        for r in pipeline.execute(sql, params):
            payload = {
                "provider": PROVIDER_INSTAGRAM,
                "external_content_id": r["post_id"],
                "google_place_id": r["google_place_id"],
                "dish_category_id": r["dish_category_id"],
            }
            rows.append({
                **payload,
                "canonical_url": r["canonical_url"],
                "thumbnail_url": None,  # IG はサムネイル複製不可。dmee は参照 URL を持つが取込時に解決
                "row_hash": stable_record_hash(payload),
                "built_at": now_iso, "run_id": run_id,
            })
        pipeline.delete_run_rows(TABLE_DISH_MEDIA_CATALOG, run_id)
        count = pipeline.load_json_rows(TABLE_DISH_MEDIA_CATALOG, rows) if rows else 0
        result["row_count"] = count
        LOGGER.info("sns_dish_media_catalog に %d 件（配信可 ready）を組みました", count)


if __name__ == "__main__":
    main()
