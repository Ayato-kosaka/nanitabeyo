#!/usr/bin/env python3
"""#1881 `existing_pg_serving_values_preserved` が **どの列で**落ちているかを数える（読み取り専用）。

## なぜ要るか

2026-09-09、承認をもらって `3_4` を流し直したあと `8_1` が 2 つのゲートで落ちた。

    FAIL existing_pg_serving_values_preserved  observed=2469.0 threshold=0.0

このゲートは **8 列をまとめて** «どれか 1 つでも違えば 1 件» と数えるので、
落ちた数字だけでは «どの列が原因か» が分からない。

⚠️ **数字が出ているのに原因が分からない状態で `9_1` を流さない。**
`9_1` は dev の 62 万行を書き換える。列ごとの内訳を先に出す。

## 疑っていること（確かめる対象であって、結論ではない）

`3_4` は `address_components_json` を

    COALESCE(NULLIF(existing.address_components_json, ''), NULLIF(s...., ''), '[]')

と正規化する（空文字を `[]` へ寄せる）が、`8_1` は
`catalog.address_components_json IS DISTINCT FROM existing.address_components_json`
と **完全一致**を求める。`existing` が空文字の行はここで必ず食い違う。

これが当たっているなら «片方が正規化し、もう片方が正規化前と比べている» という
形の食い違いで、`country_code`（#1881 で変えた列）とは無関係である。

読み取り専用。1 行も書き換えない。

実行:
    python3 scripts/20260808T0000_restaurant/9_9_inspect_serving_value_drift.py \
        --run-id restaurant-2026-08-23
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id  # noqa: E402

LOGGER = logging.getLogger(__name__)

# ⚠️ 8_1 が比べている列と **同じ組**であること。ここがずれると別のものを数える。
COMPARED_COLUMNS = (
    ("name", "catalog.name IS DISTINCT FROM existing.name"),
    (
        "name_language_code",
        "catalog.name_language_code IS DISTINCT FROM "
        "COALESCE(NULLIF(existing.name_language_code, ''), 'ja')",
    ),
    ("latitude", "catalog.latitude IS DISTINCT FROM existing.latitude"),
    ("longitude", "catalog.longitude IS DISTINCT FROM existing.longitude"),
    ("image_url", "catalog.image_url IS DISTINCT FROM existing.image_url"),
    ("image_path", "catalog.image_path IS DISTINCT FROM existing.image_path"),
    (
        "address_components_json",
        "catalog.address_components_json IS DISTINCT FROM existing.address_components_json",
    ),
    ("plus_code_json", "catalog.plus_code_json IS DISTINCT FROM existing.plus_code_json"),
)


def build_query(dataset: str) -> str:
    per_column = ",\n          ".join(
        f"COUNTIF({expr}) AS mismatch_{name}" for name, expr in COMPARED_COLUMNS
    )
    empty_probes = ",\n          ".join(
        [
            "COUNTIF(existing.address_components_json = '') AS existing_address_components_empty",
            "COUNTIF(existing.address_components_json IS NULL) AS existing_address_components_null",
            "COUNTIF(catalog.address_components_json = '[]') AS catalog_address_components_bracket",
            "COUNTIF(existing.image_url = '') AS existing_image_url_empty",
            "COUNTIF(existing.image_url IS NULL) AS existing_image_url_null",
        ]
    )
    return f"""
      SELECT
          COUNT(*) AS compared_rows,
          {per_column},
          {empty_probes}
      FROM `{dataset}.restaurant_seed_catalog` seed
      INNER JOIN `{dataset}.restaurant_source_records` existing
        ON existing.run_id = @run_id
       AND existing.source = 'existing_pg'
       AND existing.source_record_id = seed.existing_restaurant_id
      INNER JOIN `{dataset}.restaurant_catalog` catalog
        ON catalog.run_id = @run_id
       AND catalog.seed_id = seed.seed_id
      WHERE seed.run_id = @run_id
    """


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id")
    args = parser.parse_args()
    run_id = require_run_id(args.run_id)

    from google.cloud import bigquery

    pipeline = BigQueryPipeline()
    rows = list(
        pipeline.execute(
            build_query(pipeline.dataset_ref),
            parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)],
        )
    )
    row = dict(rows[0])

    LOGGER.info("=" * 70)
    LOGGER.info("# existing_pg_serving_values_preserved の内訳（run_id=%s）", run_id)
    LOGGER.info("=" * 70)
    LOGGER.info("突き合わせた行: %s", f"{row['compared_rows']:,}")
    LOGGER.info("")
    LOGGER.info("## 列ごとの食い違い（8_1 と同じ比較式）")
    for name, _expr in COMPARED_COLUMNS:
        count = row[f"mismatch_{name}"]
        mark = "  ← ここ" if count else ""
        LOGGER.info("  %-26s : %8s 件%s", name, f"{count:,}", mark)

    LOGGER.info("")
    LOGGER.info("## 空文字 / NULL の分布（正規化のずれを見分けるため）")
    for key in (
        "existing_address_components_empty",
        "existing_address_components_null",
        "catalog_address_components_bracket",
        "existing_image_url_empty",
        "existing_image_url_null",
    ):
        LOGGER.info("  %-38s : %8s 件", key, f"{row[key]:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
