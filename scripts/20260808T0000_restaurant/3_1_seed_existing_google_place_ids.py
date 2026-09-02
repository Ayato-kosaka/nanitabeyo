#!/usr/bin/env python3
"""既存PostgreSQL由来のGoogle Place IDを、検索せずmatch catalogへ引き継ぐ。"""

from __future__ import annotations

import argparse
from pathlib import Path

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="既存Google Place IDをmatch catalogへ移植します"
    )
    parser.add_argument("--run-id")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()

    # seed catalogは毎runのcurrent snapshotなので、ここもCREATE OR REPLACEする。
    # 同一Google Place IDが複数seedへ付いた場合は検索へ回さず、品質事故として隔離する。
    sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_google_place_match_catalog`
      CLUSTER BY match_status, google_place_id, seed_id
      OPTIONS (description = '既存DB移植・ダブルクエリ・手動確定を統合した現在の採用結果。')
      AS
      WITH seeds AS (
        SELECT
          *,
          COUNTIF(existing_google_place_id IS NOT NULL) OVER (
            PARTITION BY existing_google_place_id
          ) AS existing_place_id_count
        FROM `{pipeline.dataset_ref}.restaurant_seed_catalog`
        WHERE run_id = @run_id
      )
      SELECT
        @run_id AS run_id,
        seed_id,
        existing_google_place_id AS google_place_id,
        CASE
          WHEN existing_google_place_id IS NULL THEN 'not_attempted'
          WHEN existing_place_id_count > 1 THEN 'conflict_duplicate_place_id'
          ELSE 'existing_pg_matched'
        END AS match_status,
        CASE
          WHEN existing_google_place_id IS NULL THEN 'none'
          ELSE 'existing_pg_carry_forward'
        END AS match_method,
        CASE WHEN existing_google_place_id IS NULL THEN NULL ELSE 1.0 END AS match_confidence,
        CAST(NULL AS STRING) AS source_attempt_id,
        CASE WHEN existing_google_place_id IS NULL THEN NULL ELSE CURRENT_TIMESTAMP() END AS confirmed_at,
        CURRENT_TIMESTAMP() AS built_at
      FROM seeds
    """
    parameters = [bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    with pipeline.step(
        run_id, "3_1_seed_existing_google_place_ids", repo_root=REPO_ROOT
    ) as step:
        pipeline.execute(sql, parameters)
        step["row_count"] = next(
            iter(
                pipeline.execute(
                    f"SELECT COUNT(*) AS c FROM `{pipeline.dataset_ref}.restaurant_google_place_match_catalog`"
                )
            )
        ).c


if __name__ == "__main__":
    main()
