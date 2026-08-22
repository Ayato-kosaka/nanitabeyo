#!/usr/bin/env python3
"""共通形式のsource recordsを、Google Place ID検索前の実店舗seedへ統合する。"""

from __future__ import annotations

import argparse
import json
import tempfile
from collections.abc import Iterable
from pathlib import Path

from google.cloud import bigquery

from entity_resolution import (
    EntityResolver,
    SourceLink,
    SourceRecord,
    link_to_bq_row,
    seed_to_bq_row,
)
from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    json_default,
    require_run_id,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="source recordsを実店舗seedへ名寄せします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--cross-source-radius-m", type=float, default=150.0)
    parser.add_argument("--same-source-radius-m", type=float, default=50.0)
    parser.add_argument("--fuzzy-threshold", type=float, default=0.6)
    return parser.parse_args()


def iter_records(pipeline: BigQueryPipeline, run_id: str) -> Iterable[SourceRecord]:
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )
    # EntityResolverのSOURCE_PRIORITYと同じ順序で返す。これにより1.4M行を
    # Python側でsortするメモリを使わない。
    sql = f"""
      SELECT *
      FROM `{pipeline.dataset_ref}.restaurant_source_records`
      WHERE run_id = @run_id
      ORDER BY
        CASE source
          WHEN 'overture' THEN 10
          WHEN 'existing_pg' THEN 20
          WHEN 'osm' THEN 30
          WHEN 'ifas' THEN 40
          WHEN 'food_permit' THEN 50
          ELSE 999
        END,
        source_record_id
    """
    rows = pipeline.client.query(
        sql, job_config=job_config, location=pipeline.config.region
    ).result(page_size=10_000)
    for row in rows:
        yield SourceRecord(
            source=row.source,
            source_record_id=row.source_record_id,
            name=row.name,
            address=row.address or "",
            latitude=row.latitude,
            longitude=row.longitude,
            normalized_name=row.normalized_name,
            normalized_name_l1=row.normalized_name_l1,
            normalized_address=row.normalized_address or "",
            phone=row.phone,
            website=row.website,
            social_urls=tuple(row.social_urls or ()),
            existing_restaurant_id=row.existing_restaurant_id,
            google_place_id=row.google_place_id,
            image_url=row.image_url,
            image_path=row.image_path,
            address_components_json=row.address_components_json,
            plus_code_json=row.plus_code_json,
        )


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    resolver = EntityResolver(
        cross_source_radius_m=args.cross_source_radius_m,
        same_source_radius_m=args.same_source_radius_m,
        fuzzy_threshold=args.fuzzy_threshold,
    )
    parameters = {
        "cross_source_radius_m": args.cross_source_radius_m,
        "same_source_radius_m": args.same_source_radius_m,
        "fuzzy_threshold": args.fuzzy_threshold,
    }

    with pipeline.step(
        run_id,
        "2_2_build_restaurant_seed_catalog",
        parameters=parameters,
        repo_root=REPO_ROOT,
    ) as step:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ndjson", encoding="utf-8", delete=False
        ) as link_stream:
            link_path = Path(link_stream.name)
            link_count = 0

            def write_link(link: SourceLink) -> None:
                nonlocal link_count
                link_stream.write(
                    json.dumps(
                        link_to_bq_row(link, run_id),
                        ensure_ascii=False,
                        default=json_default,
                    )
                    + "\n"
                )
                link_count += 1

            seeds = resolver.resolve_stream(
                iter_records(pipeline, run_id), on_link=write_link, presorted=True
            )

        try:
            if not seeds or link_count == 0:
                raise RuntimeError(
                    "seedまたはsource linkが0件です。2_1の出力を確認してください。"
                )
            seed_count = pipeline.load_json_rows(
                "restaurant_seed_catalog",
                (seed_to_bq_row(seed, run_id) for seed in seeds),
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            )
            loaded_links = pipeline.load_ndjson_file(
                "restaurant_seed_source_links",
                link_path,
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            )
            if loaded_links != link_count:
                raise RuntimeError(
                    f"source link件数不一致: generated={link_count}, loaded={loaded_links}"
                )
        finally:
            link_path.unlink(missing_ok=True)

        step["row_count"] = seed_count


if __name__ == "__main__":
    main()
