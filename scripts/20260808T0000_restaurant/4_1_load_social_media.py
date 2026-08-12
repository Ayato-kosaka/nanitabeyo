#!/usr/bin/env python3
"""権利根拠を確認済みのInstagram/TikTok/X投稿一覧をBigQuery rawへ投入する。"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from pathlib import Path

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    sha256_file,
)
from social_media_input import iter_input_rows, normalize_input_row

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="SNS dish mediaの既知URL一覧をロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--observed-date", type=date.fromisoformat, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    parser.add_argument("--source-release", required=True)
    parser.add_argument("--license-id", required=True)
    parser.add_argument("--attribution-text")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not args.input.is_file():
        raise FileNotFoundError(args.input)
    pipeline = BigQueryPipeline()
    batch_observed_at = datetime.now(timezone.utc)

    parameters = {
        "observed_date": args.observed_date,
        "source_release": args.source_release,
        "source_uri": args.source_uri,
    }
    with pipeline.step(
        run_id, "4_1_load_social_media", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        pipeline.delete_run_rows(
            "dish_media_social_raw",
            run_id,
            partition_field="observed_date",
            partition_date=args.observed_date,
        )
        row_count = pipeline.load_json_rows(
            "dish_media_social_raw",
            (
                normalize_input_row(
                    row,
                    run_id=run_id,
                    observed_date=args.observed_date,
                    observed_at=batch_observed_at,
                )
                for row in iter_input_rows(args.input)
            ),
        )
        step["row_count"] = row_count
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "social_media",
                "snapshot_date": args.observed_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": args.source_uri,
                "local_file_name": args.input.name,
                "sha256": sha256_file(args.input),
                "license_id": args.license_id,
                "terms_version": args.source_release,
                "attribution_text": args.attribution_text,
                "row_count": row_count,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
