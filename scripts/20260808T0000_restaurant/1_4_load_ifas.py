#!/usr/bin/env python3
"""IFAS自治体CSVをBigQuery rawへロードする。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

from normalization import parse_float, parse_japanese_date
from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    require_run_id,
    sha256_file,
    stable_record_hash,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
IFAS_NAME = "営業施設名称、屋号又は商号"
IFAS_ADDRESS = "営業施設所在地"
IFAS_BUSINESS_TYPE = "営業の種類"
IFAS_FORMAT = "業態"
IFAS_LAT = "緯度"
IFAS_LON = "経度"
IFAS_PHONE = "営業施設電話番号"
IFAS_EXPIRY = "許可満了日"
IFAS_CLOSED = "廃業年月日"
IFAS_ROW_ID = "行番号"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="IFAS CSV snapshotをBigQueryへロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--source-release")
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument(
        "--source-uri",
        default="https://i2fas.mhlw.go.jp/fifas/portal/open-data/index.html",
    )
    return parser.parse_args()


def combined_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def iter_ifas_rows(paths: list[Path], args: argparse.Namespace, run_id: str):
    # IFASの行番号は自治体CSVをまたいで重複することがある。POCで確認した
    # snapshot内重複をそのまま名寄せ候補へ水増ししないよう、公開行番号を
    # source全体のIDとして最初の1件だけ採用する。
    seen_source_ids: set[str] = set()
    for path in paths:
        jurisdiction_code = path.name.split("_", 1)[0]
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for row_number, row in enumerate(csv.DictReader(stream), 2):
                business_type = (row.get(IFAS_BUSINESS_TYPE) or "").strip()
                if (
                    "飲食店営業" not in business_type
                    and "喫茶店営業" not in business_type
                ):
                    continue

                expires_on = parse_japanese_date(row.get(IFAS_EXPIRY))
                closed_raw = (row.get(IFAS_CLOSED) or "").strip()
                closed_on = parse_japanese_date(closed_raw)
                # 日付表現をparseできなくても、廃業欄に値があれば営業中扱いしない。
                is_active = not closed_raw and (
                    expires_on is None or expires_on >= args.as_of
                )
                raw_id = (row.get(IFAS_ROW_ID) or "").strip() or str(row_number)
                source_record_id = (
                    raw_id
                    if (row.get(IFAS_ROW_ID) or "").strip()
                    else f"{jurisdiction_code}:line:{row_number}"
                )
                if source_record_id in seen_source_ids:
                    continue
                seen_source_ids.add(source_record_id)
                payload = {
                    "jurisdiction_code": jurisdiction_code,
                    "source_record_id": source_record_id,
                    "name": (row.get(IFAS_NAME) or "").strip() or None,
                    "address": (row.get(IFAS_ADDRESS) or "").strip() or None,
                    "latitude": parse_float(row.get(IFAS_LAT)),
                    "longitude": parse_float(row.get(IFAS_LON)),
                    "phone": (row.get(IFAS_PHONE) or "").strip() or None,
                    "business_type": business_type or None,
                    "business_format": (row.get(IFAS_FORMAT) or "").strip() or None,
                    "permit_expires_on": expires_on,
                    "closed_on": closed_on,
                    "is_active": is_active,
                    "raw_payload_json": json.dumps(
                        row, ensure_ascii=False, sort_keys=True
                    ),
                }
                yield {
                    "run_id": run_id,
                    "snapshot_date": args.snapshot_date.isoformat(),
                    "source_release": args.source_release,
                    **payload,
                    "record_hash": stable_record_hash(payload),
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                }


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    paths = sorted(args.directory.glob("*_food_business_all.csv"))
    if not paths:
        raise FileNotFoundError(f"IFAS CSVがありません: {args.directory}")

    pipeline = BigQueryPipeline()
    parameters = {
        "snapshot_date": args.snapshot_date,
        "as_of": args.as_of,
        "source_release": args.source_release,
        "files": len(paths),
    }
    with pipeline.step(
        run_id, "1_4_load_ifas", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        pipeline.delete_run_rows(
            "restaurant_ifas_raw",
            run_id,
            partition_field="snapshot_date",
            partition_date=args.snapshot_date,
        )
        loaded = pipeline.load_json_rows(
            "restaurant_ifas_raw", iter_ifas_rows(paths, args, run_id)
        )
        step["row_count"] = loaded
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "ifas",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": args.source_uri,
                "local_file_name": f"{len(paths)} municipality CSV files",
                "sha256": combined_sha256(paths),
                "license_id": "PDL-1.0",
                "terms_version": args.source_release,
                "attribution_text": "厚生労働省 食品衛生申請等システム",
                "row_count": loaded,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
