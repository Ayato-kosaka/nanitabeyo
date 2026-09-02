#!/usr/bin/env python3
"""固定した Overture GeoParquet から日本の food_and_drink をロードする。"""

from __future__ import annotations

import argparse
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    sha256_file,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Overture Places snapshotをBigQueryへロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument("--source-release", required=True, help="例: 2026-07-22.0")
    parser.add_argument("--parquet", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    return parser.parse_args()


def build_filtered_parquet(
    source: Path, destination: Path, run_id: str, snapshot_date: date, release: str
) -> int:
    source_path = sql_literal(str(source.resolve()))
    destination_path = sql_literal(str(destination.resolve()))
    connection = duckdb.connect()
    try:
        # raw snapshotそのものはローカルファイルのchecksumで固定する。BigQueryには、
        # 後続の名寄せに必要な列を型付きで保存し、790k件×巨大JSONの重複保持を避ける。
        query = f"""
        COPY (
          SELECT
            {sql_literal(run_id)}::VARCHAR AS run_id,
            {sql_literal(snapshot_date.isoformat())}::DATE AS snapshot_date,
            {sql_literal(release)}::VARCHAR AS source_release,
            id::VARCHAR AS source_record_id,
            names.primary::VARCHAR AS name,
            coalesce(addresses[1].freeform::VARCHAR, '') AS address,
            ((bbox.ymin + bbox.ymax) / 2)::DOUBLE AS latitude,
            ((bbox.xmin + bbox.xmax) / 2)::DOUBLE AS longitude,
            basic_category::VARCHAR AS primary_category,
            coalesce(taxonomy.hierarchy, []::VARCHAR[]) AS categories,
            operating_status::VARCHAR AS operating_status,
            confidence::DOUBLE AS confidence,
            -- Overtureはfeatureごとにsource/licenseが異なる。manifestの一律表記へ
            -- 潰さず、元のsources配列を各行に残してattributionを再現可能にする。
            coalesce(to_json(sources)::VARCHAR, '[]') AS sources_json,
            coalesce(phones, []::VARCHAR[]) AS phones,
            coalesce(websites, []::VARCHAR[]) AS websites,
            coalesce(socials, []::VARCHAR[]) AS socials,
            NULL::VARCHAR AS raw_payload_json,
            sha256(concat_ws('|', id::VARCHAR, coalesce(names.primary::VARCHAR, ''),
              coalesce(addresses[1].freeform::VARCHAR, ''),
              coalesce(((bbox.ymin + bbox.ymax) / 2)::VARCHAR, ''),
              coalesce(((bbox.xmin + bbox.xmax) / 2)::VARCHAR, ''),
              coalesce(basic_category::VARCHAR, ''),
              coalesce(to_json(taxonomy.hierarchy)::VARCHAR, '[]'),
              coalesce(operating_status::VARCHAR, ''),
              coalesce(confidence::VARCHAR, ''),
              coalesce(to_json(sources)::VARCHAR, '[]'),
              coalesce(to_json(phones)::VARCHAR, '[]'),
              coalesce(to_json(websites)::VARCHAR, '[]'),
              coalesce(to_json(socials)::VARCHAR, '[]'))) AS record_hash,
            current_timestamp AS ingested_at
          FROM read_parquet({source_path})
          -- 日本の絞り込みは住所ではなく座標で行う。addresses[1].country = 'JP' は
          -- 住所が付いていない行を丸ごと落とし、実測で22%（約29万行）を捨てていた
          -- （#1276 PoC）。住所はクエリBを組むのに使うだけで、名寄せの判定は
          -- 店名と座標があれば成立する。カテゴリも taxonomy だけでは
          -- パン屋・菓子店が欠けるため basic_category を併用する。
          WHERE bbox.xmin BETWEEN 122.0 AND 154.0
            AND bbox.ymin BETWEEN 20.0 AND 46.5
            AND (
              list_contains(taxonomy.hierarchy, 'food_and_drink')
              OR basic_category IN (
                'restaurant', 'bar', 'cafe', 'casual_eatery', 'coffee_shop',
                'food_and_beverage_store', 'bakery', 'dessert_shop', 'pub',
                'fast_food_restaurant'
              )
            )
            AND names.primary IS NOT NULL
            AND bbox IS NOT NULL
        ) TO {destination_path} (FORMAT PARQUET, COMPRESSION ZSTD)
        """
        connection.execute(query)
        return int(
            connection.execute(
                f"SELECT count(*) FROM read_parquet({destination_path})"
            ).fetchone()[0]
        )
    finally:
        connection.close()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not args.parquet.is_file():
        raise FileNotFoundError(args.parquet)

    pipeline = BigQueryPipeline()
    parameters = {
        "snapshot_date": args.snapshot_date,
        "source_release": args.source_release,
        "source_uri": args.source_uri,
    }
    with pipeline.step(
        run_id, "1_3_load_overture", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as stream:
            filtered_path = Path(stream.name)
        try:
            expected = build_filtered_parquet(
                args.parquet,
                filtered_path,
                run_id,
                args.snapshot_date,
                args.source_release,
            )
            if expected == 0:
                raise RuntimeError(
                    "Overtureの日本food_and_drink抽出結果が0件です。release/schemaを確認してください。"
                )
            pipeline.delete_run_rows(
                "restaurant_overture_raw",
                run_id,
                partition_field="snapshot_date",
                partition_date=args.snapshot_date,
            )
            loaded = pipeline.load_parquet("restaurant_overture_raw", filtered_path)
            if loaded != expected:
                raise RuntimeError(
                    f"Overture件数不一致: extracted={expected}, loaded={loaded}"
                )
        finally:
            filtered_path.unlink(missing_ok=True)

        step["row_count"] = loaded
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "overture",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": args.source_uri,
                "local_file_name": args.parquet.name,
                "sha256": sha256_file(args.parquet),
                # 実際のlicenseはfeature内sources_jsonで追跡する。このmanifest値を
                # 一律license名として再利用してはいけない。
                "license_id": "per-feature-overture-sources",
                "terms_version": args.source_release,
                "attribution_text": "Overture Maps Foundation and source data providers",
                "row_count": loaded,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
