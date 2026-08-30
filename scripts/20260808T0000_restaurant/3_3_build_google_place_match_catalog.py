#!/usr/bin/env python3
"""既存ID・ダブル検索・人手overrideからGoogle Place ID採用表を再生成する。"""

from __future__ import annotations

import argparse
from pathlib import Path

from google.cloud import bigquery

from google_place_matching import ALGORITHM_VERSION
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Google Place ID match catalogを生成します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--attempt-lookback-days", type=int, default=90)
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.attempt_lookback_days <= 0:
        raise ValueError("--attempt-lookback-days は1以上にしてください")
    pipeline = BigQueryPipeline()

    # 優先順位は「最新の人手判断 > 既存PG > 自動照合」。reject overrideは
    # google_place_idをNULLにして必ずpublish対象外とする。
    sql = f"""
      CREATE OR REPLACE TABLE `{pipeline.dataset_ref}.restaurant_google_place_match_catalog`
      CLUSTER BY match_status, google_place_id, seed_id
      OPTIONS (description = '既存DB移植・ダブルクエリ・手動確定を統合した現在の採用結果。')
      AS
      WITH latest_attempt AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            a.*,
            ROW_NUMBER() OVER (
              PARTITION BY seed_id ORDER BY attempted_at DESC, attempt_id DESC
            ) AS rn
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_attempts` a
          WHERE attempted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
                                     AND CURRENT_DATE()
            AND run_id = @run_id
            AND algorithm_version = @algorithm_version
        )
        WHERE rn = 1
      ),
      latest_override AS (
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            o.*,
            ROW_NUMBER() OVER (
              PARTITION BY seed_id ORDER BY decided_at DESC
            ) AS rn
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_overrides` o
        )
        WHERE rn = 1
      ),
      resolved AS (
        SELECT
          s.seed_id,
          CASE
            WHEN o.decision = 'reject' THEN NULL
            WHEN o.decision = 'accept' THEN o.google_place_id
            WHEN s.existing_google_place_id IS NOT NULL THEN s.existing_google_place_id
            WHEN a.result_status = 'box_unique_strict' THEN a.matched_place_id
            ELSE NULL
          END AS google_place_id,
          CASE
            WHEN o.decision = 'reject' THEN 'manual_rejected'
            WHEN o.decision = 'accept' AND o.google_place_id IS NOT NULL THEN 'manual_matched'
            WHEN o.decision IS NOT NULL THEN 'invalid_override'
            WHEN s.existing_google_place_id IS NOT NULL THEN 'existing_pg_matched'
            WHEN s.conflict_reason IS NOT NULL THEN 'conflict_seed'
            WHEN a.result_status IS NOT NULL THEN a.result_status
            ELSE 'not_attempted'
          END AS base_status,
          CASE
            WHEN o.decision IS NOT NULL THEN 'manual_override'
            WHEN s.existing_google_place_id IS NOT NULL THEN 'existing_pg_carry_forward'
            WHEN a.result_status IS NOT NULL THEN @algorithm_version
            ELSE 'none'
          END AS match_method,
          CASE
            WHEN o.decision = 'accept' THEN 1.0
            WHEN s.existing_google_place_id IS NOT NULL THEN 1.0
            -- ラベル 6,000 件で確定 5,083 件・裁定後の誤り0件（95%下限 99.92%）。
            -- 1.0 にしないのは、別のラベル集合でも0である保証が無いため。
            WHEN a.result_status = 'box_unique_strict' THEN 0.999
            ELSE NULL
          END AS match_confidence,
          a.attempt_id AS source_attempt_id,
          COALESCE(o.decided_at, a.attempted_at) AS confirmed_at
        FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
        LEFT JOIN latest_attempt a USING (seed_id)
        LEFT JOIN latest_override o USING (seed_id)
        WHERE s.run_id = @run_id
      ),
      duplicate_checked AS (
        SELECT
          *,
          COUNTIF(google_place_id IS NOT NULL) OVER (PARTITION BY google_place_id) AS place_id_count,
          -- 同じ place_id に複数 seed が当たったとき、既存PG由来（現行DBに
          -- 実在する店）と手動確定は「その place_id である」ことが確定して
          -- いるので勝たせ、open data 側だけを隔離する。両方落とすと本番の
          -- 実在店舗が catalog から消え、8_1 の
          -- existing_pg_restaurants_preserved が落ちる（実測673件）。
          -- 優先度が同じ seed 同士が競合した場合は従来どおり両方隔離する。
          ROW_NUMBER() OVER (
            PARTITION BY google_place_id
            ORDER BY
              CASE base_status
                WHEN 'existing_pg_matched' THEN 0
                WHEN 'manual_matched' THEN 1
                ELSE 2
              END,
              seed_id
          ) AS place_id_rank,
          COUNTIF(base_status IN ('existing_pg_matched', 'manual_matched'))
            OVER (PARTITION BY google_place_id) AS authoritative_count
        FROM resolved
      )
      SELECT
        @run_id AS run_id,
        seed_id,
        google_place_id,
        CASE
          WHEN google_place_id IS NOT NULL
               AND place_id_count > 1
               -- 権威ある seed が「ちょうど1件」あるとき、その1件だけを残す。
               -- 2件以上あるなら既存DB側が矛盾しているので人手判断へ回す。
               AND NOT (authoritative_count = 1 AND place_id_rank = 1)
            THEN 'conflict_duplicate_place_id'
          ELSE base_status
        END AS match_status,
        match_method,
        match_confidence,
        source_attempt_id,
        confirmed_at,
        CURRENT_TIMESTAMP() AS built_at
      FROM duplicate_checked
    """
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter(
            "lookback_days", "INT64", args.attempt_lookback_days
        ),
        bigquery.ScalarQueryParameter("algorithm_version", "STRING", ALGORITHM_VERSION),
    ]
    with pipeline.step(
        run_id,
        "3_3_build_google_place_match_catalog",
        parameters={"attempt_lookback_days": args.attempt_lookback_days},
        repo_root=REPO_ROOT,
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
