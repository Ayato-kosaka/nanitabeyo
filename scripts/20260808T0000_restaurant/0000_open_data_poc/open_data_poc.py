#!/usr/bin/env python3
"""Reproducible coverage POC for Japanese restaurant open data.

Downloading, measurement and reference matching are deliberately separated.
Source snapshots are immutable inputs and this script never writes to the app DB.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence


ROOT = Path(__file__).resolve().parent
LOCK_PATH = ROOT / "sources.lock.json"
USER_AGENT = "nanitabeyo-open-data-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
CORE_OSM_AMENITIES = (
    "restaurant", "cafe", "fast_food", "bar", "pub",
    "food_court", "ice_cream", "biergarten",
)
OSM_FIELDS = (
    "name", "opening_hours", "phone", "website", "cuisine", "wheelchair",
    "outdoor_seating", "internet_access", "payment:credit_cards",
)
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


@dataclass(frozen=True)
class Candidate:
    source: str
    source_id: str
    name: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Match:
    reference_id: str
    source: str | None
    source_id: str | None
    method: str
    confidence: float
    distance_m: float | None
    ambiguous: bool


def load_lock(path: Path = LOCK_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def http_get(url: str, *, timeout: int = 120, retries: int = 4) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 == retries:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def download(url: str, destination: Path, expected_sha256: str | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=300) as response, temporary.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    actual = digest.hexdigest()
    if expected_sha256 and actual != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"checksum mismatch: expected {expected_sha256}, got {actual}")
    temporary.replace(destination)


def parse_jurisdiction_codes(script: str) -> list[str]:
    return sorted(set(re.findall(r"_i_n(\d{5})_str", script)))


def download_ifas(destination: Path, *, delay_seconds: float = 0.2) -> list[Path]:
    lock = load_lock()["ifas"]
    script = http_get(lock["jurisdiction_list_script"]).decode("utf-8", errors="replace")
    codes = parse_jurisdiction_codes(script)
    expected = int(lock["jurisdiction_files"])
    if len(codes) != expected:
        raise RuntimeError(f"IFAS jurisdiction list changed: expected {expected}, found {len(codes)}")
    destination.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for index, code in enumerate(codes, 1):
        target = destination / f"{code}_food_business_all.csv"
        if not target.exists():
            url = lock["download_template"].format(municipality_code=code)
            target.write_bytes(http_get(url, timeout=300))
            time.sleep(delay_seconds)
        print(f"[{index:03}/{len(codes)}] {target.name}", file=sys.stderr)
        files.append(target)
    return files


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    return "".join(character for character in value if character.isalnum())


def parse_float(value: str | None) -> float | None:
    try:
        number = float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return number if number is not None and math.isfinite(number) else None


def parse_japanese_date(value: str | None) -> date | None:
    if not value:
        return None
    normalized = unicodedata.normalize("NFKC", value.strip())
    match = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", normalized)
    if not match:
        return None
    try:
        return date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def is_active_ifas(row: Mapping[str, str], as_of: date) -> bool:
    if (row.get(IFAS_CLOSED) or "").strip():
        return False
    expiry = parse_japanese_date(row.get(IFAS_EXPIRY))
    return expiry is None or expiry >= as_of


def iter_ifas(directory: Path) -> Iterator[dict[str, str]]:
    for path in sorted(directory.glob("*_food_business_all.csv")):
        with path.open(encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)


def ifas_metrics(directory: Path, as_of: date) -> tuple[dict[str, Any], list[Candidate]]:
    rows = relevant = active = 0
    unique_ids: set[str] = set()
    relevant_ids: set[str] = set()
    missing = Counter()
    formats = Counter()
    prefectures = Counter()
    named_addresses: set[tuple[str, str]] = set()
    candidates_by_identity: dict[tuple[str, str], Candidate] = {}

    for row in iter_ifas(directory):
        rows += 1
        source_id = (row.get(IFAS_ROW_ID) or "").strip()
        if source_id:
            unique_ids.add(source_id)
        business_type = row.get(IFAS_BUSINESS_TYPE) or ""
        if "飲食店営業" not in business_type and "喫茶店営業" not in business_type:
            continue
        relevant += 1
        if source_id:
            relevant_ids.add(source_id)
        if not is_active_ifas(row, as_of):
            continue
        active += 1
        name = (row.get(IFAS_NAME) or "").strip()
        address = (row.get(IFAS_ADDRESS) or "").strip()
        lat, lon = parse_float(row.get(IFAS_LAT)), parse_float(row.get(IFAS_LON))
        if not name:
            missing["name"] += 1
        if not address:
            missing["address"] += 1
        if lat is None or lon is None:
            missing["coordinates"] += 1
        if not (row.get(IFAS_PHONE) or "").strip():
            missing["phone"] += 1
        formats[(row.get(IFAS_FORMAT) or "(blank)").strip() or "(blank)"] += 1
        prefectures[(row.get("都道府県名") or "(blank)").strip() or "(blank)"] += 1
        identity = (normalize_name(name), unicodedata.normalize("NFKC", address))
        if name and address:
            named_addresses.add(identity)
        if name and address and lat is not None and lon is not None:
            candidates_by_identity.setdefault(
                identity, Candidate("ifas", source_id, name, lat, lon)
            )

    metrics = {
        "snapshot_as_of": as_of.isoformat(),
        "files": len(list(directory.glob("*_food_business_all.csv"))),
        "all_rows": rows,
        "all_unique_row_ids": len(unique_ids),
        "duplicate_rows": rows - len(unique_ids),
        "restaurant_or_cafe_rows": relevant,
        "restaurant_or_cafe_unique_row_ids": len(relevant_ids),
        "active_rows": active,
        "active_exact_name_address_entities": len(named_addresses),
        "active_exact_name_address_entities_with_coordinates": len(candidates_by_identity),
        "active_missing": dict(missing),
        "active_missing_percent": {
            key: round(value * 100 / active, 2) if active else None
            for key, value in missing.items()
        },
        "top_business_formats": dict(formats.most_common(25)),
        "prefecture_rows": dict(prefectures.most_common()),
    }
    return metrics, list(candidates_by_identity.values())


def duckdb_connection() -> Any:
    try:
        import duckdb  # type: ignore
    except ImportError as error:
        raise RuntimeError("DuckDB is required. Run: python -m pip install -r requirements.txt") from error
    return duckdb.connect()


def overture_metrics(parquet: Path) -> tuple[dict[str, Any], list[Candidate]]:
    connection = duckdb_connection()
    escaped = str(parquet).replace("'", "''")
    predicate = "addresses[1].country = 'JP' AND list_contains(taxonomy.hierarchy, 'food_and_drink')"
    connection.execute(
        f"CREATE TEMP VIEW jp_food AS SELECT * FROM read_parquet('{escaped}') WHERE {predicate}"
    )
    total, names, addresses, phones, websites, socials, emails, high_confidence = connection.execute(
        """
        SELECT count(*), count(names.primary), count(addresses), count(phones),
               count(websites), count(socials), count(emails),
               count(*) FILTER (WHERE confidence >= 0.8)
        FROM jp_food
        """
    ).fetchone()
    categories = dict(connection.execute(
        "SELECT coalesce(basic_category, '(null)'), count(*) FROM jp_food GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall())
    source_rows = dict(connection.execute(
        """
        SELECT source.dataset, count(*) FROM jp_food, unnest(sources) AS t(source)
        GROUP BY 1 ORDER BY 2 DESC
        """
    ).fetchall())
    statuses = dict(connection.execute(
        "SELECT coalesce(operating_status, '(null)'), count(*) FROM jp_food GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall())
    confidence = dict(connection.execute(
        """
        SELECT cast(round(confidence, 1) AS varchar), count(*)
        FROM jp_food GROUP BY 1 ORDER BY 1
        """
    ).fetchall())
    duplicate_name_coordinates = connection.execute(
        """
        SELECT coalesce(sum(n - 1), 0) FROM (
          SELECT count(*) AS n FROM jp_food WHERE names.primary IS NOT NULL
          GROUP BY lower(regexp_replace(names.primary, '[[:space:][:punct:]]', '', 'g')),
                   round((bbox.ymin + bbox.ymax) / 2, 4),
                   round((bbox.xmin + bbox.xmax) / 2, 4)
          HAVING count(*) > 1
        )
        """
    ).fetchone()[0]
    candidates = [
        Candidate("overture", row[0], row[1], row[2], row[3])
        for row in connection.execute(
            """
            SELECT id, names.primary, (bbox.ymin + bbox.ymax) / 2,
                   (bbox.xmin + bbox.xmax) / 2
            FROM jp_food WHERE names.primary IS NOT NULL AND bbox IS NOT NULL
            """
        ).fetchall()
    ]
    metrics = {
        "rows": total,
        "field_present": {
            "name": names, "addresses": addresses, "phones": phones,
            "websites": websites, "socials": socials, "emails": emails,
        },
        "field_present_percent": {
            "name": round(names * 100 / total, 2),
            "addresses": round(addresses * 100 / total, 2),
            "phones": round(phones * 100 / total, 2),
            "websites": round(websites * 100 / total, 2),
            "socials": round(socials * 100 / total, 2),
            "emails": round(emails * 100 / total, 2),
        },
        "confidence_at_least_0_8": high_confidence,
        "confidence_at_least_0_8_percent": round(high_confidence * 100 / total, 2),
        "primary_categories": categories,
        "source_dataset_rows": source_rows,
        "operating_status": statuses,
        "confidence_histogram": confidence,
        "approx_duplicate_excess_same_name_rounded_coordinates": duplicate_name_coordinates,
    }
    return metrics, candidates


def osm_tag_count(api_root: str, key: str, value: str | None = None) -> int:
    endpoint = f"{api_root}/tag/stats?key={urllib.parse.quote(key)}"
    if value is not None:
        endpoint += f"&value={urllib.parse.quote(value)}"
    payload = json.loads(http_get(endpoint))
    for item in payload.get("data", []):
        if item.get("type") == "all":
            return int(item.get("count", 0))
    raise RuntimeError(f"unexpected Taginfo response for {key}={value}")


def osm_metrics(api_root: str) -> dict[str, Any]:
    amenity_counts = {value: osm_tag_count(api_root, "amenity", value) for value in CORE_OSM_AMENITIES}
    total = sum(amenity_counts.values())
    field_counts: dict[str, int] = {}
    for field in OSM_FIELDS:
        count = 0
        for amenity in CORE_OSM_AMENITIES:
            endpoint = (
                f"{api_root}/tag/combinations?key=amenity&value={urllib.parse.quote(amenity)}"
                "&page=1&rp=1000&sortname=together_count&sortorder=desc"
            )
            payload = json.loads(http_get(endpoint))
            aggregate = next((
                item for item in payload.get("data", [])
                if item.get("other_key") == field and item.get("other_value") == ""
            ), None)
            count += int(aggregate.get("together_count", 0)) if aggregate else 0
        field_counts[field] = count
    return {
        "core_amenity_rows": total,
        "amenities": amenity_counts,
        "field_present": field_counts,
        "field_present_percent": {
            key: round(value * 100 / total, 2) if total else None
            for key, value in field_counts.items()
        },
    }


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_008.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


class SpatialCandidateIndex:
    def __init__(self, candidates: Iterable[Candidate], cell_degrees: float = 0.002) -> None:
        self.cell_degrees = cell_degrees
        self.by_cell: dict[tuple[int, int], list[tuple[Candidate, str]]] = defaultdict(list)
        for candidate in candidates:
            self.by_cell[self.cell(candidate.latitude, candidate.longitude)].append(
                (candidate, normalize_name(candidate.name))
            )

    def cell(self, latitude: float, longitude: float) -> tuple[int, int]:
        return (math.floor(latitude / self.cell_degrees), math.floor(longitude / self.cell_degrees))

    def nearby(self, latitude: float, longitude: float) -> Iterator[tuple[Candidate, str]]:
        lat_cell, lon_cell = self.cell(latitude, longitude)
        for lat_offset in (-1, 0, 1):
            for lon_offset in (-1, 0, 1):
                yield from self.by_cell.get((lat_cell + lat_offset, lon_cell + lon_offset), ())


def match_one(
    reference_id: str,
    name: str,
    latitude: float,
    longitude: float,
    indexes: Sequence[SpatialCandidateIndex],
    *,
    radius_m: float = 100.0,
    fuzzy_threshold: float = 0.88,
) -> Match:
    normalized = normalize_name(name)
    possible: list[tuple[int, float, float, Candidate]] = []
    for index in indexes:
        for candidate, candidate_name in index.nearby(latitude, longitude):
            distance = haversine_m(latitude, longitude, candidate.latitude, candidate.longitude)
            if distance > radius_m:
                continue
            similarity = SequenceMatcher(None, normalized, candidate_name).ratio() if normalized else 0.0
            tier = 2 if normalized and normalized == candidate_name else 1 if similarity >= fuzzy_threshold else 0
            if tier:
                possible.append((tier, similarity, distance, candidate))
    if not possible:
        return Match(reference_id, None, None, "unmatched", 0.0, None, False)
    possible.sort(key=lambda item: (-item[0], -item[1], item[2], item[3].source, item[3].source_id))
    best = possible[0]
    tied = [item for item in possible if item[0] == best[0] and abs(item[1] - best[1]) < 0.01]
    ambiguous = len({(item[3].source, item[3].source_id) for item in tied}) > 1
    method = "ambiguous" if ambiguous else "exact_name_nearby" if best[0] == 2 else "fuzzy_name_nearby"
    return Match(reference_id, best[3].source, best[3].source_id, method,
                 round(best[1], 4), round(best[2], 2), ambiguous)


def exact_source_overlap(
    left: Sequence[Candidate], right: Sequence[Candidate], *, radius_m: float = 100.0
) -> dict[str, Any]:
    """Conservative lower-bound overlap using exact normalized names and distance."""
    index = SpatialCandidateIndex(right)
    matched_left = ambiguous_left = 0
    matched_right_ids: set[str] = set()
    for candidate in left:
        normalized = normalize_name(candidate.name)
        possible: set[str] = set()
        for other, other_name in index.nearby(candidate.latitude, candidate.longitude):
            if normalized != other_name:
                continue
            if haversine_m(candidate.latitude, candidate.longitude,
                           other.latitude, other.longitude) <= radius_m:
                possible.add(other.source_id)
        if possible:
            matched_left += 1
            matched_right_ids.update(possible)
            ambiguous_left += len(possible) > 1
    return {
        "method": f"exact_normalized_name_within_{radius_m:g}m",
        "left_source": left[0].source if left else None,
        "right_source": right[0].source if right else None,
        "left_candidates": len(left),
        "matched_left": matched_left,
        "matched_left_percent": round(matched_left * 100 / len(left), 2) if left else None,
        "ambiguous_left": ambiguous_left,
        "distinct_matched_right": len(matched_right_ids),
        "warning": "Conservative lower bound only; spelling differences and displaced coordinates are not matched.",
    }


def read_reference(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    required = {"id", "name", "latitude", "longitude"}
    fields = set(rows[0]) if rows else set()
    missing = required - fields
    if missing:
        raise ValueError(f"reference CSV is missing columns: {', '.join(sorted(missing))}")
    return rows


def match_reference(
    path: Path,
    source_candidates: Mapping[str, Sequence[Candidate]],
    output_directory: Path,
) -> dict[str, Any]:
    rows = read_reference(path)
    indexes = [SpatialCandidateIndex(candidates) for candidates in source_candidates.values() if candidates]
    matches: list[Match] = []
    invalid = 0
    for row in rows:
        lat, lon = parse_float(row.get("latitude")), parse_float(row.get("longitude"))
        if lat is None or lon is None:
            invalid += 1
            matches.append(Match(row["id"], None, None, "invalid_coordinates", 0.0, None, False))
            continue
        matches.append(match_one(row["id"], row["name"], lat, lon, indexes))

    output_directory.mkdir(parents=True, exist_ok=True)
    match_path = output_directory / "reference_matches.csv"
    with match_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(Match.__annotations__))
        writer.writeheader()
        writer.writerows(asdict(item) for item in matches)
    unmatched_ids = {item.reference_id for item in matches if item.source is None or item.ambiguous}
    unmatched_path = output_directory / "unmatched_reference.csv"
    with unmatched_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ["id", "name", "latitude", "longitude"])
        writer.writeheader()
        writer.writerows(row for row in rows if row["id"] in unmatched_ids)
    accepted = sum(item.source is not None and not item.ambiguous for item in matches)
    return {
        "reference_rows": len(rows),
        "accepted_matches": accepted,
        "ambiguous_matches": sum(item.ambiguous for item in matches),
        "unmatched": sum(item.source is None for item in matches),
        "invalid_coordinates": invalid,
        "coverage_percent": round(accepted * 100 / len(rows), 2) if rows else None,
        "acceptance_gate_100_percent": accepted == len(rows) and bool(rows),
        "matches_csv": str(match_path),
        "unmatched_csv": str(unmatched_path),
    }


def command_download_overture(arguments: argparse.Namespace) -> None:
    lock = load_lock()["overture"]
    download(lock["asset"], arguments.output, lock["sha256"])
    print(arguments.output)


def command_download_ifas(arguments: argparse.Namespace) -> None:
    files = download_ifas(arguments.output, delay_seconds=arguments.delay_seconds)
    print(json.dumps({"files": len(files), "directory": str(arguments.output)}, ensure_ascii=False))


def command_analyze(arguments: argparse.Namespace) -> None:
    report: dict[str, Any] = {
        "measured_at": date.today().isoformat(),
        "method_version": 1,
        "warnings": [
            "Source row count is not true-market coverage; duplicates, closed businesses and non-public food operations can remain.",
            "Reference matches are candidate links, never automatic Google place_id assertions.",
        ],
    }
    candidates: dict[str, Sequence[Candidate]] = {}
    if arguments.overture_parquet:
        report["overture"], candidates["overture"] = overture_metrics(arguments.overture_parquet)
    if arguments.ifas_dir:
        report["ifas"], candidates["ifas"] = ifas_metrics(arguments.ifas_dir, arguments.as_of)
    if "ifas" in candidates and "overture" in candidates and not arguments.skip_overlap:
        report["ifas_to_overture_overlap"] = exact_source_overlap(
            candidates["ifas"], candidates["overture"]
        )
    if not arguments.skip_osm:
        report["osm"] = osm_metrics(load_lock()["osm"]["taginfo_api"])
    if arguments.reference_csv:
        report["reference_coverage"] = match_reference(
            arguments.reference_csv, candidates, arguments.output.parent / "reference-matching"
        )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(arguments.output)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subcommands = result.add_subparsers(required=True)
    overture = subcommands.add_parser("download-overture", help="download the pinned Overture parquet")
    overture.add_argument("--output", type=Path, default=ROOT / "data" / "overture-asia.parquet")
    overture.set_defaults(function=command_download_overture)
    ifas = subcommands.add_parser("download-ifas", help="download all public IFAS jurisdiction CSV files")
    ifas.add_argument("--output", type=Path, default=ROOT / "data" / "ifas")
    ifas.add_argument("--delay-seconds", type=float, default=0.2)
    ifas.set_defaults(function=command_download_ifas)
    analyze = subcommands.add_parser("analyze", help="measure snapshots and optionally test current-DB coverage")
    analyze.add_argument("--overture-parquet", type=Path)
    analyze.add_argument("--ifas-dir", type=Path)
    analyze.add_argument("--reference-csv", type=Path)
    analyze.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    analyze.add_argument("--skip-osm", action="store_true")
    analyze.add_argument("--skip-overlap", action="store_true")
    analyze.add_argument("--output", type=Path, default=ROOT / "out" / "report.json")
    analyze.set_defaults(function=command_analyze)
    return result


def main() -> None:
    arguments = parser().parse_args()
    arguments.function(arguments)


if __name__ == "__main__":
    main()
