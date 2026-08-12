#!/usr/bin/env python3
"""既存 PostgreSQL restaurants を BigQuery raw へsnapshotする。

既存DBは「既にユーザーが検索した店舗」という需要実績である。オープンデータに
存在しないからといって消さず、2_2で carry-forward できるよう最初に取り込む。
"""

from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    stable_record_hash,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="既存 restaurants を BigQueryへsnapshotします"
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        "--snapshot-date",
        type=date.fromisoformat,
        default=datetime.now(timezone.utc).date(),
    )
    parser.add_argument("--schema", choices=("dev", "public"), required=True)
    return parser.parse_args()


def iter_restaurants(connection: Any, schema: str, run_id: str, snapshot_date: date):
    # named cursorにより、将来100万件を超えても全件をPython listへ載せない。
    with connection.cursor(name="restaurant_bq_snapshot") as cursor:
        cursor.itersize = 5_000
        cursor.execute(
            f"""
            SELECT
              id::text,
              google_place_id,
              name,
              name_language_code,
              latitude,
              longitude,
              image_url,
              image_path,
              address_components::text,
              plus_code::text,
              created_at
            FROM {schema}.restaurants
            ORDER BY id
            """
        )
        for row in cursor:
            payload = {
                "source_record_id": row[0],
                "google_place_id": row[1],
                "name": row[2],
                "name_language_code": row[3],
                "latitude": row[4],
                "longitude": row[5],
                "image_url": row[6],
                "image_path": row[7],
                "address_components_json": row[8],
                "plus_code_json": row[9],
                "created_at": row[10],
            }
            yield {
                "run_id": run_id,
                "snapshot_date": snapshot_date.isoformat(),
                **payload,
                "record_hash": stable_record_hash(payload),
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            }


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL が必要です")

    pipeline = BigQueryPipeline()
    parameters = {"snapshot_date": args.snapshot_date, "pg_schema": args.schema}
    with pipeline.step(
        run_id,
        "1_2_import_existing_pg_restaurants",
        parameters=parameters,
        repo_root=REPO_ROOT,
    ) as step:
        pipeline.delete_run_rows(
            "restaurant_existing_pg_raw",
            run_id,
            partition_field="snapshot_date",
            partition_date=args.snapshot_date,
        )
        with psycopg2.connect(database_url, connect_timeout=15) as connection:
            row_count = pipeline.load_json_rows(
                "restaurant_existing_pg_raw",
                iter_restaurants(connection, args.schema, run_id, args.snapshot_date),
            )
        step["row_count"] = row_count
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "existing_pg",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.schema,
                "source_uri": None,
                "local_file_name": None,
                "sha256": None,
                "license_id": "first_party",
                "terms_version": None,
                "attribution_text": None,
                "row_count": row_count,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
