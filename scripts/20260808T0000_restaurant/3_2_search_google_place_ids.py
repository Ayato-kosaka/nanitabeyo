#!/usr/bin/env python3
"""未確定restaurant seedだけをGoogle Text Search ID Onlyで照合する。

費用・誤更新を避けるため、デフォルトは候補件数を表示するだけである。APIを呼ぶには
``--execute`` と有限の ``--limit`` を明示し、まず小さいbatchから結果分布を確認する。
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from google_place_matching import (
    ALGORITHM_VERSION,
    PlacesTextSearchClient,
    TextSearchResult,
    build_query_payloads,
    decide_match,
)
from normalization import build_attempt_id
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="未確定seedをGoogle Place IDへ照合します"
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--limit",
        type=int,
        required=True,
        help="今回処理するseed上限。費用上限でもある",
    )
    parser.add_argument(
        "--execute", action="store_true", help="指定時だけGoogle APIとBQ書込を実行"
    )
    parser.add_argument("--qps", type=float, default=5.0)
    parser.add_argument("--radius-m", type=float, default=150.0)
    parser.add_argument("--resume-days", type=int, default=90)
    parser.add_argument(
        "--include-osm-only",
        action="store_true",
        help="ODbL公開方針の承認後に、OSM canonical seedも検索対象へ含める",
    )
    return parser.parse_args()


def fetch_candidates(
    pipeline: BigQueryPipeline,
    run_id: str,
    limit: int,
    resume_days: int,
    include_osm_only: bool,
) -> list[Any]:
    # attemptsはpartition filter必須。resume windowを明示して、同じrun/versionの
    # 成否を問わず再課金しない。再試行したい場合はalgorithm versionを更新する。
    sql = f"""
      SELECT s.seed_id, s.canonical_name, s.canonical_address, s.latitude, s.longitude
      FROM `{pipeline.dataset_ref}.restaurant_seed_catalog` s
      WHERE s.run_id = @run_id
        AND s.existing_google_place_id IS NULL
        AND s.conflict_reason IS NULL
        -- OSM-only derived databaseの公開条件が未承認のまま、照合費用を使わない。
        AND (@include_osm_only OR s.seed_origin != 'osm_only')
        AND NOT EXISTS (
          SELECT 1
          FROM `{pipeline.dataset_ref}.restaurant_google_place_match_attempts` a
          WHERE a.attempted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @resume_days DAY)
                                     AND CURRENT_DATE()
            AND a.run_id = @run_id
            AND a.seed_id = s.seed_id
            AND a.algorithm_version = @algorithm_version
        )
      ORDER BY s.seed_id
      LIMIT @limit
    """
    parameters = [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("resume_days", "INT64", resume_days),
        bigquery.ScalarQueryParameter("algorithm_version", "STRING", ALGORITHM_VERSION),
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("include_osm_only", "BOOL", include_osm_only),
    ]
    return list(pipeline.execute(sql, parameters))


def attempt_row(
    *,
    run_id: str,
    seed: Any,
    radius_m: float,
    client: PlacesTextSearchClient,
) -> dict[str, Any]:
    query_a, query_b, body_a, body_b = build_query_payloads(
        seed.canonical_name,
        seed.canonical_address or "",
        seed.latitude,
        seed.longitude,
        radius_m,
    )
    has_address = bool((seed.canonical_address or "").strip())
    if has_address:
        result_a = client.search(body_a)
        result_b = client.search(body_b)
    else:
        # 同じ文字列を2回検索しても独立検証にならないため、APIを消費せず保留にする。
        result_a = TextSearchResult((), None)
        result_b = TextSearchResult((), None)
    decision = decide_match(result_a, result_b, has_address=has_address)
    now = utc_now()
    errors = [
        message
        for message in (result_a.error_message, result_b.error_message)
        if message
    ]
    return {
        "attempted_date": now.date().isoformat(),
        "attempt_id": build_attempt_id(run_id, seed.seed_id, ALGORITHM_VERSION),
        "run_id": run_id,
        "seed_id": seed.seed_id,
        "algorithm_version": ALGORITHM_VERSION,
        "query_a": query_a,
        "query_b": query_b,
        "place_ids_a": list(result_a.place_ids),
        "place_ids_b": list(result_b.place_ids),
        "matched_place_id": decision.matched_place_id,
        "result_status": decision.status,
        "http_status_a": result_a.http_status,
        "http_status_b": result_b.http_status,
        "error_message": " | ".join(errors)[:16_000] or None,
        "attempted_at": now.isoformat(),
    }


def flush_rows(pipeline: BigQueryPipeline, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    # attempt_idをinsertIdにも使う。resume queryと組み合わせ、手動再実行の重複を防ぐ。
    errors = pipeline.client.insert_rows_json(
        pipeline.table("restaurant_google_place_match_attempts"),
        rows,
        row_ids=[row["attempt_id"] for row in rows],
    )
    if errors:
        raise RuntimeError(f"Google match attemptsの保存に失敗しました: {errors}")
    rows.clear()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.limit <= 0:
        raise ValueError("--limit は1以上にしてください")
    if args.qps <= 0 or not 0 < args.radius_m <= 50_000 or args.resume_days <= 0:
        raise ValueError("--qps/--radius-m/--resume-days が不正です")

    pipeline = BigQueryPipeline()
    candidates = fetch_candidates(
        pipeline,
        run_id,
        args.limit,
        args.resume_days,
        args.include_osm_only,
    )
    LOGGER.info("今回のGoogle照合候補: %d件（limit=%d）", len(candidates), args.limit)
    if not args.execute:
        LOGGER.info("dry-runです。実行する場合は --execute を付けてください。")
        for row in candidates[:10]:
            LOGGER.info("candidate seed_id=%s name=%s", row.seed_id, row.canonical_name)
        return

    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise ValueError("--execute には GOOGLE_MAPS_API_KEY が必要です")
    client = PlacesTextSearchClient(api_key, qps=args.qps)
    buffer: list[dict[str, Any]] = []
    parameters = {
        "limit": args.limit,
        "qps": args.qps,
        "radius_m": args.radius_m,
        "algorithm_version": ALGORITHM_VERSION,
        "include_osm_only": args.include_osm_only,
    }
    with pipeline.step(
        run_id,
        "3_2_search_google_place_ids",
        parameters=parameters,
        repo_root=REPO_ROOT,
    ) as step:
        for index, seed in enumerate(candidates, start=1):
            buffer.append(
                attempt_row(
                    run_id=run_id,
                    seed=seed,
                    radius_m=args.radius_m,
                    client=client,
                )
            )
            if len(buffer) >= 100:
                flush_rows(pipeline, buffer)
            if index % 1000 == 0:
                LOGGER.info("Google照合: %d/%d件", index, len(candidates))
        flush_rows(pipeline, buffer)
        step["row_count"] = len(candidates)


if __name__ == "__main__":
    main()
