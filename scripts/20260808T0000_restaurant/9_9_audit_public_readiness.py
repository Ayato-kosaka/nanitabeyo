#!/usr/bin/env python3
"""«この catalog を public へ流したら何が起きるか» を数える（読み取り専用）。

## なぜ要るか

catalog の `existing_*` は **1_2 がどのスキーマを読んだか**に依存する。
`existing_restaurant_id`（PG の UUID）は #1674 で外したが、
**表示値の carry-forward（name / 座標 / image_url / image_path /
address_components / plus_code）は残っている**。

  COALESCE(existing.name, s.canonical_name) AS name
  COALESCE(existing.image_path, s.image_path) AS image_path
  ...

いまの catalog は dev のスナップショットで作られているので、これらの行は
**dev の値**を持つ。それを public へ流すと、public に同じ place_id が無い行は
dev 由来の値のまま新規作成される（在れば ON CONFLICT DO NOTHING で無害）。

何行がその状態なのかを数える。**1 行も書き換えない。**
"""

from __future__ import annotations

import argparse
import logging

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="public 適用の影響を数えます")
    parser.add_argument("--run-id")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    ds = pipeline.dataset_ref

    rows = list(
        pipeline.execute(
            f"""
            SELECT
              COUNT(*) AS published_rows,
              COUNTIF(e.source_record_id IS NOT NULL) AS from_existing_pg,
              -- 以下は «dev の値がそのまま catalog に載っている» 行
              COUNTIF(NULLIF(e.image_path, '') IS NOT NULL) AS carries_dev_image_path,
              COUNTIF(NULLIF(e.address_components_json, '') IS NOT NULL
                      AND e.address_components_json != '[]') AS carries_dev_address_components,
              COUNTIF(e.plus_code_json IS NOT NULL) AS carries_dev_plus_code,
              COUNTIF(NULLIF(e.image_url, '') IS NOT NULL) AS carries_dev_image_url,
              COUNTIF(e.name IS NOT NULL AND e.name != s.canonical_name) AS name_differs_from_open_data
            FROM `{ds}.restaurant_catalog` c
            JOIN `{ds}.restaurant_seed_catalog` s
              ON s.run_id = @run_id AND s.seed_id = c.seed_id
            LEFT JOIN `{ds}.restaurant_source_records` e
              ON e.run_id = @run_id AND e.source = 'existing_pg'
             AND e.source_record_id = s.existing_restaurant_id
            WHERE c.run_id = @run_id
            """,
            [bigquery.ScalarQueryParameter("run_id", "STRING", run_id)],
        )
    )
    LOGGER.info("=== public へ流したときに dev 由来の値を持ち込む行 ===")
    for row in rows:
        for key, value in dict(row).items():
            LOGGER.info("  %-32s %s", key, value)

    LOGGER.info("")
    LOGGER.info("※ public に同じ google_place_id が既に在れば ON CONFLICT DO NOTHING で")
    LOGGER.info("   無害。無い場合だけ dev 由来の値で新規作成される。")


if __name__ == "__main__":
    main()
