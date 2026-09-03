#!/usr/bin/env python3
"""PR #1700 のレビュー指摘を «実測» で確かめる（読み取り専用）。

指摘を鵜呑みにも却下にもせず、数える。1 行も書き換えない。
"""

from __future__ import annotations

import argparse
import logging

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="レビュー指摘を実測します")
    parser.add_argument("--run-id")
    return parser.parse_args()


def show(pipeline: BigQueryPipeline, title: str, sql: str, run_id: str) -> None:
    LOGGER.info("")
    LOGGER.info("=== %s ===", title)
    rows = list(
        pipeline.execute(sql, [bigquery.ScalarQueryParameter("run_id", "STRING", run_id)])
    )
    if not rows:
        LOGGER.info("  (0 行)")
        return
    for row in rows:
        LOGGER.info("  %s", dict(row))


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    ds = pipeline.dataset_ref

    # ① 兄弟合併が conflict_duplicate_place_id の seed から値を取っていないか
    show(
        pipeline,
        "① 兄弟 seed の match_status 別（合併元になりうる seed）",
        f"""
        SELECT m3.match_status, COUNT(*) AS sibling_rows,
               COUNT(DISTINCT m3.google_place_id) AS places
        FROM `{ds}.restaurant_google_place_match_catalog` m2
        JOIN `{ds}.restaurant_google_place_match_catalog` m3
          ON m3.run_id = m2.run_id AND m3.google_place_id = m2.google_place_id
         AND m3.seed_id != m2.seed_id
        WHERE m2.run_id = @run_id AND m2.google_place_id IS NOT NULL
          AND m2.match_status IN ('existing_pg_matched','box_unique_strict','manual_matched')
        GROUP BY 1 ORDER BY 2 DESC
        """,
        run_id,
    )

    # ② IFAS のスナップショットが 120 日窓に何本入っているか
    show(
        pipeline,
        "② restaurant_ifas_raw の snapshot_date（120日窓）",
        f"""
        SELECT CAST(snapshot_date AS STRING) AS snapshot_date,
               COUNT(*) AS rows_, COUNT(DISTINCT source_record_id) AS distinct_records
        FROM `{ds}.restaurant_ifas_raw`
        WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
        GROUP BY 1 ORDER BY 1 DESC
        """,
        run_id,
    )
    show(
        pipeline,
        "②-b 閉店レコードが窓内で何回現れるか（2 回以上なら重複で捨てている）",
        f"""
        SELECT appearances, COUNT(*) AS records FROM (
          SELECT source_record_id, COUNT(*) AS appearances
          FROM `{ds}.restaurant_ifas_raw`
          WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
            AND (is_active = FALSE OR closed_on IS NOT NULL)
            AND latitude IS NOT NULL AND longitude IS NOT NULL
          GROUP BY 1
        ) GROUP BY 1 ORDER BY 1
        """,
        run_id,
    )

    # ③ 海外行が seed / catalog に入っているか（次の全体 run で品質ゲートを落とすか）
    show(
        pipeline,
        "③ 日本の矩形の外にある行（source_records / seed / catalog）",
        f"""
        SELECT 'source_records' AS stage, source, COUNT(*) AS out_of_box
        FROM `{ds}.restaurant_source_records`
        WHERE run_id = @run_id
          AND (latitude NOT BETWEEN 20.0 AND 46.5 OR longitude NOT BETWEEN 122.0 AND 154.0)
        GROUP BY 1, 2
        UNION ALL
        SELECT 'seed_catalog', 'all', COUNT(*)
        FROM `{ds}.restaurant_seed_catalog`
        WHERE run_id = @run_id
          AND (latitude NOT BETWEEN 20.0 AND 46.5 OR longitude NOT BETWEEN 122.0 AND 154.0)
        UNION ALL
        SELECT 'restaurant_catalog', 'all', COUNT(*)
        FROM `{ds}.restaurant_catalog`
        WHERE run_id = @run_id
          AND (latitude NOT BETWEEN 20.0 AND 46.5 OR longitude NOT BETWEEN 122.0 AND 154.0)
        """,
        run_id,
    )

    # ④ 同じ restaurant に open_data の website / phone が複数付いていないか
    #    （catalog 側は 1 本ずつなので、複数あれば «過去の値が残っている» ことになる）
    show(
        pipeline,
        "④ catalog 側で 1 店に複数の電話/サイトが割り当たっていないか",
        f"""
        SELECT COUNTIF(phone IS NOT NULL) AS with_phone,
               COUNTIF(website IS NOT NULL) AS with_website,
               COUNT(*) AS rows_
        FROM `{ds}.restaurant_catalog` WHERE run_id = @run_id
        """,
        run_id,
    )


if __name__ == "__main__":
    main()
