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
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

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

# Conservative L1 rules.  Legal entity markers are removed anywhere, while
# store-kind suffixes are removed only from the end so that names such as
# "喫茶店営業部" do not collapse unexpectedly.
LEGAL_ENTITY_MARKERS = (
    "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
    "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
    "医療法人", "社会福祉法人", "特定非営利活動法人", "npo法人",
    "(株)", "(有)", "㈱", "㈲",
)
STORE_KIND_SUFFIXES = (
    "本店", "支店", "本館", "別館", "営業所", "店", "店舗",
)
KANJI_VARIANTS = str.maketrans({"髙": "高", "﨑": "崎", "邊": "辺", "邉": "辺", "濵": "浜", "神": "神"})


@dataclass(frozen=True)
class Candidate:
    source: str
    source_id: str
    name: str
    latitude: float
    longitude: float
    address: str = ""
    website_count: int = 0
    social_count: int = 0


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


def normalize_name_l1(value: str) -> str:
    """Normalize Japanese business names without removing cuisine words."""
    normalized = unicodedata.normalize("NFKC", value or "").translate(KANJI_VARIANTS).casefold()
    for marker in LEGAL_ENTITY_MARKERS:
        normalized = normalized.replace(unicodedata.normalize("NFKC", marker).casefold(), "")
    normalized = "".join(character for character in normalized if character.isalnum())
    for suffix in sorted(STORE_KIND_SUFFIXES, key=len, reverse=True):
        if normalized.endswith(suffix) and len(normalized) > len(suffix) + 1:
            normalized = normalized[:-len(suffix)]
            break
    return normalized


def normalize_address(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").translate(KANJI_VARIANTS).casefold()
    normalized = re.sub(r"〒?\s*\d{3}[-ー]?\d{4}", "", normalized)
    normalized = normalized.replace("丁目", "-").replace("番地", "-").replace("番", "-").replace("号", "")
    normalized = re.sub(r"[のノ]", "-", normalized)
    normalized = re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠-]+", "", normalized)
    return re.sub(r"-+", "-", normalized).strip("-")


def trigram_similarity(left: str, right: str) -> float:
    """A dependency-free approximation of PostgreSQL pg_trgm similarity()."""
    def trigrams(value: str) -> set[str]:
        padded = f"  {value} "
        return {padded[index:index + 3] for index in range(max(0, len(padded) - 2))}

    left_trigrams, right_trigrams = trigrams(left), trigrams(right)
    if not left_trigrams or not right_trigrams:
        return 0.0
    common = len(left_trigrams & right_trigrams)
    return common / (len(left_trigrams) + len(right_trigrams) - common)


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
                identity, Candidate("ifas", source_id, name, lat, lon, address)
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


def legacy_csv_metrics(manifest_path: Path) -> tuple[dict[str, Any], list[Candidate]]:
    """Load municipality pre-2021 permit CSVs through an explicit column manifest.

    Municipality files are intentionally not guessed: their schemas and encodings
    vary, so every source must declare its provenance and mapping in JSON.
    """
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sources = manifest.get("sources", [])
    if not isinstance(sources, list) or not sources:
        raise ValueError("legacy CSV manifest must contain a non-empty sources array")
    all_candidates: list[Candidate] = []
    source_metrics: dict[str, Any] = {}
    for source in sources:
        source_name = str(source["name"])
        path = Path(source["path"])
        if not path.is_absolute():
            path = manifest_path.parent / path
        columns = source.get("columns", {})
        required = {"name", "address", "latitude", "longitude"}
        missing_mapping = required - set(columns)
        if missing_mapping:
            raise ValueError(f"{source_name}: missing column mappings: {', '.join(sorted(missing_mapping))}")
        encoding = source.get("encoding", "utf-8-sig")
        filters = source.get("filters", {})
        rows = relevant = missing_coordinates = 0
        candidate_start = len(all_candidates)
        with path.open(encoding=encoding, newline="") as stream:
            reader = csv.DictReader(stream)
            for row_number, row in enumerate(reader, 2):
                rows += 1
                filter_column = filters.get("business_type_column")
                allowed = filters.get("business_type_contains", [])
                if filter_column and allowed and not any(
                    token in (row.get(filter_column) or "") for token in allowed
                ):
                    continue
                relevant += 1
                lat = parse_float(row.get(columns["latitude"]))
                lon = parse_float(row.get(columns["longitude"]))
                if lat is None or lon is None:
                    missing_coordinates += 1
                    continue
                name = (row.get(columns["name"]) or "").strip()
                address = (row.get(columns["address"]) or "").strip()
                if not name:
                    continue
                id_column = columns.get("id")
                source_id = (row.get(id_column) or "").strip() if id_column else ""
                if not source_id:
                    source_id = f"{source_name}:{row_number}"
                all_candidates.append(Candidate(f"legacy:{source_name}", source_id, name, lat, lon, address))
        source_metrics[source_name] = {
            "path": str(path),
            "license": source.get("license"),
            "snapshot": source.get("snapshot"),
            "rows": rows,
            "relevant_rows": relevant,
            "candidates_with_coordinates": len(all_candidates) - candidate_start,
            "missing_coordinates": missing_coordinates,
        }
    return {
        "sources": source_metrics,
        "rows": sum(item["rows"] for item in source_metrics.values()),
        "candidates_with_coordinates": len(all_candidates),
    }, all_candidates


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
        SELECT count(*), count(names.primary), count(*) FILTER (WHERE len(addresses) > 0),
               count(*) FILTER (WHERE len(phones) > 0),
               count(*) FILTER (WHERE len(websites) > 0),
               count(*) FILTER (WHERE len(socials) > 0),
               count(*) FILTER (WHERE len(emails) > 0),
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
        Candidate("overture", row[0], row[1], row[2], row[3], row[4], row[5], row[6])
        for row in connection.execute(
            """
            SELECT id, names.primary, (bbox.ymin + bbox.ymax) / 2,
                   (bbox.xmin + bbox.xmax) / 2,
                   coalesce(addresses[1].freeform, ''),
                   coalesce(len(websites), 0), coalesce(len(socials), 0)
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
    metrics["contact_coverage"] = {
        "website_or_social": connection.execute(
            "SELECT count(*) FROM jp_food WHERE len(websites) > 0 OR len(socials) > 0"
        ).fetchone()[0],
        "website_and_social": connection.execute(
            "SELECT count(*) FROM jp_food WHERE len(websites) > 0 AND len(socials) > 0"
        ).fetchone()[0],
    }
    metrics["contact_coverage_percent"] = {
        key: round(value * 100 / total, 2) if total else None
        for key, value in metrics["contact_coverage"].items()
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
        self.by_cell: dict[tuple[int, int], list[tuple[Candidate, str, str, str]]] = defaultdict(list)
        for candidate in candidates:
            self.by_cell[self.cell(candidate.latitude, candidate.longitude)].append(
                (
                    candidate,
                    normalize_name(candidate.name),
                    normalize_name_l1(candidate.name),
                    normalize_address(candidate.address),
                )
            )

    def cell(self, latitude: float, longitude: float) -> tuple[int, int]:
        return (math.floor(latitude / self.cell_degrees), math.floor(longitude / self.cell_degrees))

    def nearby(self, latitude: float, longitude: float) -> Iterator[tuple[Candidate, str, str, str]]:
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
    address: str = "",
    radius_m: float = 150.0,
    fuzzy_threshold: float = 0.6,
) -> Match:
    normalized = normalize_name(name)
    normalized_l1 = normalize_name_l1(name)
    normalized_address = normalize_address(address)
    nearby: list[tuple[Candidate, str, str, str, float]] = []
    for index in indexes:
        for candidate, candidate_name, candidate_name_l1, candidate_address in index.nearby(latitude, longitude):
            distance = haversine_m(latitude, longitude, candidate.latitude, candidate.longitude)
            if distance <= radius_m:
                nearby.append((candidate, candidate_name, candidate_name_l1, candidate_address, distance))

    possible: list[tuple[int, float, float, float, Candidate]] = []
    exact = [item for item in nearby if normalized and item[1] == normalized]
    l1 = [item for item in nearby if len(normalized_l1) >= 2 and item[2] == normalized_l1]
    selected = exact or l1
    if selected:
        tier = 4 if exact else 3
        for candidate, _, _, candidate_address, distance in selected:
            address_similarity = (
                trigram_similarity(normalized_address, candidate_address)
                if normalized_address and candidate_address else 0.0
            )
            possible.append((tier, 1.0, address_similarity, distance, candidate))
    else:
        # Trigram allocation is the expensive stage.  Only perform it when the
        # two exact tiers fail for this reference row.
        for candidate, _, candidate_name_l1, candidate_address, distance in nearby:
            similarity = trigram_similarity(normalized_l1, candidate_name_l1) if normalized_l1 else 0.0
            if similarity < fuzzy_threshold:
                continue
            address_similarity = (
                trigram_similarity(normalized_address, candidate_address)
                if normalized_address and candidate_address else 0.0
            )
            possible.append((2, similarity, address_similarity, distance, candidate))
    if not possible:
        return Match(reference_id, None, None, "unmatched", 0.0, None, False)
    possible.sort(key=lambda item: (-item[0], -item[1], -item[2], item[3], item[4].source, item[4].source_id))
    best = possible[0]
    tied = [item for item in possible if item[0] == best[0] and abs(item[1] - best[1]) < 0.02]
    # Overture and IFAS often contain the same establishment.  Treat near-identical
    # cross-source records as corroboration, not ambiguity.
    materially_distinct = [
        item for item in tied
        if normalize_name_l1(item[4].name) != normalize_name_l1(best[4].name)
        or haversine_m(item[4].latitude, item[4].longitude,
                       best[4].latitude, best[4].longitude) > 50.0
    ]
    ambiguous = bool(materially_distinct)
    method = (
        "ambiguous" if ambiguous else "exact_name_nearby" if best[0] == 4
        else "l1_name_nearby" if best[0] == 3 else "trigram_name_nearby"
    )
    return Match(reference_id, best[4].source, best[4].source_id, method,
                 round(best[1], 4), round(best[3], 2), ambiguous)


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
        for other, other_name, _, _ in index.nearby(candidate.latitude, candidate.longitude):
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


def source_overlap_progression(
    left: Sequence[Candidate], right: Sequence[Candidate]
) -> dict[str, Any]:
    """Measure cumulative L0/L1/L2 overlap using the same production candidates."""
    index = SpatialCandidateIndex(right)
    counts = Counter()
    for candidate in left:
        match = match_one(
            candidate.source_id,
            candidate.name,
            candidate.latitude,
            candidate.longitude,
            [index],
            address=candidate.address,
        )
        if match.source is None or match.ambiguous:
            counts["unmatched_or_ambiguous"] += 1
        else:
            counts[match.method] += 1
    exact = counts["exact_name_nearby"]
    l1 = exact + counts["l1_name_nearby"]
    l2 = l1 + counts["trigram_name_nearby"]
    denominator = len(left)
    return {
        "method": "L0 exact → L1 legal/store-marker normalization → L2 150m + trigram",
        "left_candidates": denominator,
        "levels": {
            "l0_exact": {"matched": exact, "percent": round(exact * 100 / denominator, 2) if denominator else None},
            "l1_normalized": {"matched": l1, "percent": round(l1 * 100 / denominator, 2) if denominator else None},
            "l2_trigram_150m": {"matched": l2, "percent": round(l2 * 100 / denominator, 2) if denominator else None},
        },
        "unmatched_or_ambiguous": counts["unmatched_or_ambiguous"],
        "target_over_40_percent": bool(denominator and l2 * 100 / denominator > 40),
    }


def duplicate_cluster_metrics(
    candidates: Sequence[Candidate], *, radius_m: float = 50.0, similarity_threshold: float = 0.75
) -> dict[str, Any]:
    """Cluster likely duplicate places without materializing the full pair matrix."""
    parent = list(range(len(candidates)))
    sizes = [1] * len(candidates)

    def find(item: int) -> int:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(left_index: int, right_index: int) -> None:
        left_root, right_root = find(left_index), find(right_index)
        if left_root == right_root:
            return
        if sizes[left_root] < sizes[right_root]:
            left_root, right_root = right_root, left_root
        parent[right_root] = left_root
        sizes[left_root] += sizes[right_root]

    # Index both spatial cell and a name block.  Iterating every business in a
    # dense station cell is still effectively all-pairs, even with small cells.
    latitude_cell_degrees = radius_m / 111_000
    # One longitude degree is shortest in northern Japan.  A conservative
    # 75km/degree keeps every <= radius pair in the same or adjacent cell.
    longitude_cell_degrees = radius_m / 75_000
    normalized_names = [normalize_name_l1(candidate.name) for candidate in candidates]
    blocks: dict[tuple[int, int, str, str], list[int]] = defaultdict(list)
    for position, candidate in enumerate(candidates):
        name = normalized_names[position]
        if len(name) < 2:
            continue
        lat_cell = math.floor(candidate.latitude / latitude_cell_degrees)
        lon_cell = math.floor(candidate.longitude / longitude_cell_degrees)
        blocks[(lat_cell, lon_cell, "prefix", name[:2])].append(position)
        blocks[(lat_cell, lon_cell, "suffix", name[-2:])].append(position)
    for left_index, candidate in enumerate(candidates):
        left_name = normalized_names[left_index]
        if len(left_name) < 2:
            continue
        lat_cell = math.floor(candidate.latitude / latitude_cell_degrees)
        lon_cell = math.floor(candidate.longitude / longitude_cell_degrees)
        possible_indexes: set[int] = set()
        for lat_offset in (-1, 0, 1):
            for lon_offset in (-1, 0, 1):
                for block_type, block_value in (("prefix", left_name[:2]), ("suffix", left_name[-2:])):
                    possible_indexes.update(blocks.get(
                        (lat_cell + lat_offset, lon_cell + lon_offset, block_type, block_value), ()
                    ))
        for right_index in possible_indexes:
            if right_index <= left_index:
                continue
            other = candidates[right_index]
            other_name = normalized_names[right_index]
            if left_name != other_name:
                shorter, longer = sorted((len(left_name), len(other_name)))
                if (shorter + 2) / (longer + 2) < similarity_threshold:
                    continue
            if haversine_m(candidate.latitude, candidate.longitude,
                           other.latitude, other.longitude) > radius_m:
                continue
            if trigram_similarity(left_name, other_name) >= similarity_threshold:
                union(left_index, right_index)

    cluster_sizes = Counter(find(index_) for index_ in range(len(candidates)))
    duplicate_clusters = [size for size in cluster_sizes.values() if size > 1]
    return {
        "method": f"L1 name trigram >= {similarity_threshold:g} within {radius_m:g}m",
        "input_rows": len(candidates),
        "unique_clusters": len(cluster_sizes),
        "duplicate_excess_rows": len(candidates) - len(cluster_sizes),
        "duplicate_clusters": len(duplicate_clusters),
        "largest_cluster": max(duplicate_clusters, default=1),
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
    *,
    reviewed_unmatched_csv: Path | None = None,
    review_sample_size: int = 100,
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
        matches.append(match_one(
            row["id"], row["name"], lat, lon, indexes, address=row.get("address", "")
        ))

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
    sample_path = output_directory / "unmatched_review_sample.csv"
    sample_rows = sorted(
        (row for row in rows if row["id"] in unmatched_ids),
        key=lambda row: hashlib.sha256(row["id"].encode()).hexdigest(),
    )[:max(0, review_sample_size)]
    sample_fields = (list(rows[0]) if rows else ["id", "name", "latitude", "longitude"]) + [
        "google_maps_url", "classification", "evidence_url_or_seed_id", "notes"
    ]
    with sample_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=sample_fields)
        writer.writeheader()
        writer.writerows({
            **row,
            "google_maps_url": (
                f"https://www.google.com/maps/place/?q=place_id:{row.get('google_place_id')}"
                if row.get("google_place_id") else ""
            ),
            "classification": "",
            "evidence_url_or_seed_id": "",
            "notes": "",
        } for row in sample_rows)
    accepted = sum(item.source is not None and not item.ambiguous for item in matches)
    result = {
        "reference_rows": len(rows),
        "accepted_matches": accepted,
        "ambiguous_matches": sum(item.ambiguous for item in matches),
        "unmatched": sum(item.source is None for item in matches),
        "invalid_coordinates": invalid,
        "coverage_percent": round(accepted * 100 / len(rows), 2) if rows else None,
        "acceptance_gate_100_percent": accepted == len(rows) and bool(rows),
        "acceptance_gate_95_percent_excluding_closed": accepted * 100 / len(rows) >= 95 if rows else False,
        "matches_csv": str(match_path),
        "unmatched_csv": str(unmatched_path),
        "review_sample_csv": str(sample_path),
        "review_classifications": ["seed_missing", "matching_failure", "closed"],
    }
    if reviewed_unmatched_csv:
        with reviewed_unmatched_csv.open(encoding="utf-8-sig", newline="") as stream:
            reviewed = list(csv.DictReader(stream))
        valid_ids = unmatched_ids
        classifications: dict[str, str] = {}
        for row in reviewed:
            reference_id = (row.get("id") or "").strip()
            classification = (row.get("classification") or "").strip()
            if reference_id not in valid_ids:
                raise ValueError(f"reviewed unmatched id is not currently unmatched: {reference_id}")
            if classification not in result["review_classifications"]:
                raise ValueError(f"invalid classification for {reference_id}: {classification}")
            if reference_id in classifications:
                raise ValueError(f"duplicate reviewed unmatched id: {reference_id}")
            classifications[reference_id] = classification
        reviewed_counts = Counter(classifications.values())
        denominator = len(rows) - reviewed_counts["closed"]
        covered = accepted + reviewed_counts["matching_failure"]
        adjusted_percent = round(covered * 100 / denominator, 2) if denominator else None
        result["manual_review"] = {
            "reviewed_rows": len(classifications),
            "classifications": dict(reviewed_counts),
            "remaining_unreviewed": len(unmatched_ids) - len(classifications),
        }
        result["closed_adjusted_coverage_percent"] = adjusted_percent
        result["acceptance_gate_95_percent_excluding_closed"] = bool(
            denominator and not result["manual_review"]["remaining_unreviewed"]
            and covered * 100 / denominator >= 95
        )
    return result


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
        "method_version": 2,
        "warnings": [
            "Source row count is not true-market coverage; duplicates, closed businesses and non-public food operations can remain.",
            "Reference matches are candidate links, never automatic Google place_id assertions.",
        ],
    }
    candidates: dict[str, Sequence[Candidate]] = {}
    if arguments.overture_parquet:
        report["overture"], candidates["overture"] = overture_metrics(arguments.overture_parquet)
        if not arguments.skip_deduplication:
            report["overture"]["deduplication_50m"] = duplicate_cluster_metrics(candidates["overture"])
    if arguments.ifas_dir:
        report["ifas"], candidates["ifas"] = ifas_metrics(arguments.ifas_dir, arguments.as_of)
    if arguments.legacy_csv_manifest:
        report["legacy_permits"], candidates["legacy_permits"] = legacy_csv_metrics(
            arguments.legacy_csv_manifest
        )
    if "ifas" in candidates and "overture" in candidates and not arguments.skip_overlap:
        report["ifas_to_overture_overlap"] = exact_source_overlap(
            candidates["ifas"], candidates["overture"]
        )
        report["ifas_to_overture_match_progression"] = source_overlap_progression(
            candidates["ifas"], candidates["overture"]
        )
    if "legacy_permits" in candidates and "overture" in candidates and not arguments.skip_overlap:
        report["legacy_permits_to_overture_match_progression"] = source_overlap_progression(
            candidates["legacy_permits"], candidates["overture"]
        )
    if not arguments.skip_osm:
        report["osm"] = osm_metrics(load_lock()["osm"]["taginfo_api"])
    if arguments.reference_csv:
        report["reference_coverage"] = match_reference(
            arguments.reference_csv,
            candidates,
            arguments.output.parent / "reference-matching",
            reviewed_unmatched_csv=arguments.reviewed_unmatched_csv,
            review_sample_size=arguments.review_sample_size,
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
    analyze.add_argument("--legacy-csv-manifest", type=Path)
    analyze.add_argument("--reference-csv", type=Path)
    analyze.add_argument("--reviewed-unmatched-csv", type=Path)
    analyze.add_argument("--review-sample-size", type=int, default=100)
    analyze.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    analyze.add_argument("--skip-osm", action="store_true")
    analyze.add_argument("--skip-overlap", action="store_true")
    analyze.add_argument("--skip-deduplication", action="store_true")
    analyze.add_argument("--output", type=Path, default=ROOT / "out" / "report.json")
    analyze.set_defaults(function=command_analyze)
    return result


def main() -> None:
    arguments = parser().parse_args()
    arguments.function(arguments)


if __name__ == "__main__":
    main()
