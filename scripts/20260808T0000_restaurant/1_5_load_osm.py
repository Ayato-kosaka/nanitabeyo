#!/usr/bin/env python3
"""OSM PBFからコア飲食業態を抽出し、BigQuery rawへロードする。

全国バッチで public editing API / Overpass を使用しない。固定したPBF extractを
入力にし、source URIとchecksumをmanifestへ記録する。
"""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, TextIO

import osmium

from pipeline_common import (
    BigQueryPipeline,
    configure_logging,
    json_default,
    require_run_id,
    sha256_file,
    stable_record_hash,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CORE_AMENITIES = {
    "restaurant",
    "cafe",
    "fast_food",
    "bar",
    "pub",
    "food_court",
    "ice_cream",
    "biergarten",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="OSM PBF snapshotをBigQueryへロードします"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True)
    parser.add_argument("--source-release")
    parser.add_argument("--pbf", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    return parser.parse_args()


def build_address(tags: dict[str, str]) -> str:
    if tags.get("addr:full"):
        return tags["addr:full"]
    components = [
        tags.get("addr:province"),
        tags.get("addr:city"),
        tags.get("addr:suburb"),
        tags.get("addr:quarter"),
        tags.get("addr:street"),
        tags.get("addr:housenumber"),
    ]
    return "".join(component for component in components if component)


class RestaurantHandler(osmium.SimpleHandler):
    """PBFを全件メモリに載せずNDJSONへ順次書き出す。"""

    def __init__(self, stream: TextIO, args: argparse.Namespace, run_id: str) -> None:
        super().__init__()
        self.stream = stream
        self.args = args
        self.run_id = run_id
        self.count = 0

    def node(self, node: Any) -> None:
        if node.location.valid():
            self._emit(
                "node", node.id, dict(node.tags), node.location.lat, node.location.lon
            )

    def way(self, way: Any) -> None:
        coordinates: list[tuple[float, float]] = []
        for node in way.nodes:
            try:
                if node.location.valid():
                    coordinates.append((node.location.lat, node.location.lon))
            except osmium.InvalidLocationError:
                continue
        if coordinates:
            latitude = sum(item[0] for item in coordinates) / len(coordinates)
            longitude = sum(item[1] for item in coordinates) / len(coordinates)
            self._emit("way", way.id, dict(way.tags), latitude, longitude)

    def _emit(
        self,
        osm_type: str,
        osm_id: int,
        tags: dict[str, str],
        latitude: float,
        longitude: float,
    ) -> None:
        amenity = tags.get("amenity")
        name = tags.get("name") or tags.get("name:ja")
        if amenity not in CORE_AMENITIES or not name:
            return
        source_record_id = f"{osm_type}/{osm_id}"
        social_urls = sorted(
            {
                value
                for key in (
                    "contact:instagram",
                    "contact:tiktok",
                    "contact:twitter",
                    "contact:x",
                    "facebook",
                )
                if (value := tags.get(key))
            }
        )
        payload = {
            "source_record_id": source_record_id,
            "osm_type": osm_type,
            "osm_id": osm_id,
            "name": name,
            "address": build_address(tags) or None,
            "latitude": latitude,
            "longitude": longitude,
            "phone": tags.get("contact:phone") or tags.get("phone"),
            "website": tags.get("contact:website") or tags.get("website"),
            "social_urls": social_urls,
            "amenity": amenity,
            "cuisine": sorted(filter(None, (tags.get("cuisine") or "").split(";"))),
            "opening_hours": tags.get("opening_hours"),
            "tags_json": json.dumps(tags, ensure_ascii=False, sort_keys=True),
        }
        row = {
            "run_id": self.run_id,
            "snapshot_date": self.args.snapshot_date.isoformat(),
            "source_release": self.args.source_release,
            **payload,
            "record_hash": stable_record_hash(payload),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
        self.stream.write(
            json.dumps(row, ensure_ascii=False, default=json_default) + "\n"
        )
        self.count += 1


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if not args.pbf.is_file():
        raise FileNotFoundError(args.pbf)

    pipeline = BigQueryPipeline()
    parameters = {
        "snapshot_date": args.snapshot_date,
        "source_release": args.source_release,
        "source_uri": args.source_uri,
    }
    with pipeline.step(
        run_id, "1_5_load_osm", parameters=parameters, repo_root=REPO_ROOT
    ) as step:
        with (
            tempfile.NamedTemporaryFile(
                mode="w", suffix=".ndjson", encoding="utf-8", delete=False
            ) as stream,
            tempfile.TemporaryDirectory(prefix="osm-node-index-") as index_dir,
        ):
            temporary_path = Path(stream.name)
            handler = RestaurantHandler(stream, args, run_id)
            # 日本全土PBFの全node座標をRAMへ載せない。明示した一時file indexを使い、
            # wayの代表座標を求めた後はTemporaryDirectoryと共に確実に破棄する。
            location_index = Path(index_dir) / "node-locations.idx"
            handler.apply_file(
                str(args.pbf),
                locations=True,
                idx=f"sparse_file_array,{location_index}",
            )
        try:
            if handler.count == 0:
                raise RuntimeError(
                    "OSMのコア飲食業態抽出結果が0件です。PBF/releaseを確認してください。"
                )
            pipeline.delete_run_rows(
                "restaurant_osm_raw",
                run_id,
                partition_field="snapshot_date",
                partition_date=args.snapshot_date,
            )
            loaded = pipeline.load_ndjson_file("restaurant_osm_raw", temporary_path)
            if loaded != handler.count:
                raise RuntimeError(
                    f"OSM件数不一致: extracted={handler.count}, loaded={loaded}"
                )
        finally:
            temporary_path.unlink(missing_ok=True)

        step["row_count"] = loaded
        pipeline.append_manifest(
            {
                "run_id": run_id,
                "source": "osm",
                "snapshot_date": args.snapshot_date.isoformat(),
                "source_release": args.source_release,
                "source_uri": args.source_uri,
                "local_file_name": args.pbf.name,
                "sha256": sha256_file(args.pbf),
                "license_id": "ODbL-1.0",
                "terms_version": args.source_release,
                "attribution_text": "© OpenStreetMap contributors",
                "row_count": loaded,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )


if __name__ == "__main__":
    main()
