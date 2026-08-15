#!/usr/bin/env python3
"""自治体ごとにばらばらな許可台帳を、1つの seed CSV に揃える。

`fetch_permits.py` が集めてくるファイルは、自治体ごとに列名も文字コードも違う。
「営業所の名称、屋号または商号」「施設名称」「営業施設名称、屋号又は商号」…と
表記が割れるので、**列名を正規化してから当てる**。当たらなかったファイルは
黙って捨てず、理由つきで数える（列名の揺れを1つ拾うたびに数万行増えるので、
捨てた量が見えていないと改善できない）。

座標は入っていないことが多い。`geocode.py` のキャッシュから引き、
無ければ空にして出す。座標が無い行は矩形が作れないので名寄せできない。
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

ENCODINGS = ("utf-8-sig", "cp932", "utf-8", "euc-jp")

NAME_HINTS = ("名称", "屋号", "商号", "施設名", "店名")
NAME_EXCLUDE = ("営業者", "申請者", "法人番号", "代表者", "業種", "種別", "分類")
ADDRESS_HINTS = ("所在地", "住所", "設置場所")
TYPE_HINTS = ("営業の種類", "業種", "許可業種", "種別")
CLOSED_HINTS = ("廃業", "失効")
LATITUDE_HINTS = ("緯度", "latitude")
LONGITUDE_HINTS = ("経度", "longitude")

# IFAS と同じ基準で飲食店に絞る。ここを変えると①③の分母が動くので合わせておく。
KEEP_KEYWORDS = ("飲食店", "喫茶店", "菓子製造", "そうざい製造", "アイスクリーム")

PREFECTURE = re.compile(r"^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)")


def normalise_header(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").replace(" ", "").strip()


def pick(headers: list[str], hints: tuple[str, ...], exclude: tuple[str, ...] = ()) -> str | None:
    for header in headers:
        flat = normalise_header(header)
        if any(word in flat for word in exclude):
            continue
        if any(hint in flat for hint in hints):
            return header
    return None


def read_rows(path: Path) -> tuple[list[dict], str]:
    for encoding in ENCODINGS:
        try:
            with path.open(encoding=encoding, newline="") as handle:
                rows = list(csv.DictReader(handle))
            if rows and any(rows[0].keys()):
                return rows, encoding
        except (UnicodeDecodeError, csv.Error):
            continue
    return [], ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=ROOT / "data" / "permits")
    parser.add_argument("--geocode-cache", type=Path, default=ROOT / "cache" / "geocode.sqlite")
    parser.add_argument("--output", type=Path, default=ROOT / "out" / "permits_seeds.csv")
    parser.add_argument("--addresses-output", type=Path,
                        default=ROOT / "out" / "permit_addresses.txt")
    parser.add_argument("--report", type=Path, default=ROOT / "results" / "permits_report.json")
    arguments = parser.parse_args()

    coordinates: dict[str, tuple[float, float, str]] = {}
    if arguments.geocode_cache.exists():
        connection = sqlite3.connect(f"file:{arguments.geocode_cache}?mode=ro", uri=True)
        for address, latitude, longitude, level in connection.execute(
            "SELECT address, latitude, longitude, level FROM geocode WHERE latitude IS NOT NULL"
        ):
            coordinates[address] = (latitude, longitude, level)
        connection.close()

    stats: Counter = Counter()
    seen: set[tuple[str, str]] = set()
    rows_out: list[dict] = []
    addresses: list[str] = []

    for path in sorted(arguments.input_dir.glob("*")):
        if path.suffix.lower() not in (".csv",):
            stats["skipped_not_csv"] += 1
            continue
        rows, encoding = read_rows(path)
        if not rows:
            stats["unreadable"] += 1
            continue
        headers = list(rows[0].keys())
        name_column = pick(headers, NAME_HINTS, NAME_EXCLUDE)
        address_column = pick(headers, ADDRESS_HINTS)
        if not name_column or not address_column:
            stats["no_name_or_address_column"] += 1
            continue
        type_column = pick(headers, TYPE_HINTS)
        closed_column = pick(headers, CLOSED_HINTS)
        latitude_column = pick(headers, LATITUDE_HINTS)
        longitude_column = pick(headers, LONGITUDE_HINTS)
        stats["files_used"] += 1

        for row in rows:
            stats["rows_read"] += 1
            if closed_column and (row.get(closed_column) or "").strip():
                stats["closed"] += 1
                continue
            business = (row.get(type_column) or "") if type_column else ""
            if type_column and not any(word in business for word in KEEP_KEYWORDS):
                stats["not_a_restaurant"] += 1
                continue
            name = unicodedata.normalize("NFKC", (row.get(name_column) or "").strip())
            address = unicodedata.normalize("NFKC", (row.get(address_column) or "").strip())
            if not name:
                stats["no_name"] += 1
                continue
            if not PREFECTURE.match(address):
                stats["address_without_prefecture"] += 1
                continue
            key = (name, address)
            if key in seen:
                stats["duplicate"] += 1
                continue
            seen.add(key)

            latitude = longitude = None
            level = ""
            if latitude_column and longitude_column:
                try:
                    latitude = float(row[latitude_column])
                    longitude = float(row[longitude_column])
                    level = "source"
                except (TypeError, ValueError, KeyError):
                    latitude = longitude = None
            if latitude is None and address in coordinates:
                latitude, longitude, level = coordinates[address]
            if latitude is None:
                addresses.append(address)
                stats["needs_geocoding"] += 1
            else:
                stats["has_coordinates"] += 1
            rows_out.append(
                {
                    "seed_id": f"permit:{len(rows_out)}",
                    "name": name,
                    "address": address,
                    "business": business,
                    "latitude": "" if latitude is None else f"{latitude:.7f}",
                    "longitude": "" if longitude is None else f"{longitude:.7f}",
                    "geocode_level": level,
                    "source_file": path.name,
                }
            )

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows_out[0].keys()) if rows_out
                                else ["seed_id"])
        writer.writeheader()
        writer.writerows(rows_out)
    arguments.addresses_output.write_text("\n".join(dict.fromkeys(addresses)), encoding="utf-8")
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    report = {"rows_written": len(rows_out), **dict(stats.most_common())}
    arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
