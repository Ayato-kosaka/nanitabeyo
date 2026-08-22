#!/usr/bin/env python3
"""Overture / IFAS / OSM を一つの seed CSV へ統合する。

3ソースは同じ店を別々に持っているので、そのまま足すと同じ店へ何度も問い合わせる
ことになり、名寄せ率の分母も水増しされる。座標と名称で寄せてから出力する。

IFAS の扱いには注意が要る。営業許可のデータなので、飲食店以外（給食施設、食品
製造所、自動車での移動販売など）や、すでに廃業した施設が含まれる。Google に
載りようがない行を seed に入れると分母だけ増えるため、業態と廃業日で絞る。
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

from jp_text import normalize_for_comparison
from seeds import SEED_COLUMNS, Seed, build_address_query, normalize_name_for_query, read_seeds

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

IFAS_NAME = "営業施設名称、屋号又は商号"
IFAS_ADDRESS = "営業施設所在地"
IFAS_PREFECTURE = "都道府県名"
IFAS_CITY = "市区町村名"
IFAS_LATITUDE = "緯度"
IFAS_LONGITUDE = "経度"
IFAS_BUSINESS_TYPE = "営業の種類"
IFAS_FORMAT = "業態"
IFAS_CLOSED = "廃業年月日"

# Google に店舗として載りうる業態だけを通す。製造所・給食施設などは対象外。
IFAS_KEEP_KEYWORDS = (
    "飲食店", "喫茶店", "菓子製造", "そうざい製造", "アイスクリーム",
)


PREFECTURE = re.compile(r"^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)")
# 政令市は「〇〇市〇〇区」で1つの地名として扱う。区だけでは市が特定できない。
DESIGNATED_CITY = re.compile(r"^(.{1,6}?市.{1,5}?区)")
PLAIN_MUNICIPALITY = re.compile(r"^(.{1,8}?[市区町村])")


def municipality_of(freeform: str) -> str:
    """住所文字列から市区町村を取り出す。政令市は「〇〇市〇〇区」まで拾う。"""
    prefecture = PREFECTURE.match(freeform)
    if not prefecture:
        return ""
    rest = freeform[prefecture.end():]
    for pattern in (DESIGNATED_CITY, PLAIN_MUNICIPALITY):
        match = pattern.match(rest)
        if match:
            return match.group(1)
    return ""


def iter_ifas(directory: Path) -> Iterator[dict[str, str]]:
    for path in sorted(glob.glob(str(directory / "*.csv"))):
        with open(path, encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                yield row


def ifas_rows(directory: Path) -> tuple[list[Seed], dict[str, int]]:
    stats: Counter = Counter()
    seeds: list[Seed] = []
    for row in iter_ifas(directory):
        stats["total"] += 1
        if (row.get(IFAS_CLOSED) or "").strip():
            stats["closed"] += 1
            continue
        business = (row.get(IFAS_BUSINESS_TYPE) or "") + (row.get(IFAS_FORMAT) or "")
        if not any(keyword in business for keyword in IFAS_KEEP_KEYWORDS):
            stats["not_a_restaurant"] += 1
            continue
        name = (row.get(IFAS_NAME) or "").strip()
        if not name:
            stats["no_name"] += 1
            continue
        try:
            latitude = float(row.get(IFAS_LATITUDE) or "")
            longitude = float(row.get(IFAS_LONGITUDE) or "")
        except ValueError:
            stats["no_coordinates"] += 1
            continue
        if not (20.0 <= latitude <= 46.5 and 122.0 <= longitude <= 154.0):
            stats["bad_coordinates"] += 1
            continue
        # 都道府県名 / 市区町村名 は「許可を出した自治体」であって店の所在地ではない。
        # 北海道庁の分は全行が 北海道 / 札幌市中央区 になり、実際の店は深川市だったりする。
        # 営業施設所在地 は全行が都道府県から始まる（実測 52,392/52,392）ので、これだけ使う。
        freeform = (row.get(IFAS_ADDRESS) or "").strip()
        city = municipality_of(freeform)
        address_query, quality = build_address_query(freeform, None, city)
        stats["kept"] += 1
        seeds.append(
            Seed(
                seed_id=f"ifas:{row.get('自治体コード','')}:{row.get('行番号','')}",
                name=name,
                name_query=normalize_name_for_query(name),
                address_query=address_query,
                address_quality=quality,
                latitude=latitude,
                longitude=longitude,
                postcode="",
                freeform=freeform,
                locality=city,
                basic_category="restaurant",
                confidence=0.0,
                websites="",
            )
        )
    return seeds, dict(stats)


def osm_rows(path: Path) -> list[Seed]:
    seeds: list[Seed] = []
    with path.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            name = (row.get("name") or "").strip()
            if not name:
                continue
            address_query, quality = build_address_query(
                row.get("freeform"), row.get("postcode"), row.get("locality")
            )
            seeds.append(
                Seed(
                    seed_id=row["source_id"],
                    name=name,
                    name_query=normalize_name_for_query(name),
                    address_query=address_query,
                    address_quality=quality,
                    latitude=float(row["latitude"]),
                    longitude=float(row["longitude"]),
                    postcode=row.get("postcode") or "",
                    freeform=row.get("freeform") or "",
                    locality=row.get("locality") or "",
                    basic_category=row.get("category") or "",
                    confidence=0.0,
                    websites=row.get("website") or "",
                )
            )
    return seeds


def deduplicate(groups: list[tuple[str, list[Seed]]], *, cell_m: float = 60.0) -> tuple[list[Seed], dict[str, Any]]:
    """同じ店を指す行を1つに寄せる。

    先に来たソースを優先する（Overture を先頭に渡す）。座標を粗いグリッドに落とし、
    正規化した店名が一致する行を同一とみなす。グリッド境界で取りこぼさないよう、
    隣接セルも見る。
    """

    cell = cell_m / 111_320.0
    index: dict[tuple[int, int, str], str] = {}
    merged: list[Seed] = []
    stats: Counter = Counter()
    for source, seeds in groups:
        for seed in seeds:
            key_name = normalize_for_comparison(seed.name)
            if not key_name:
                stats[f"{source}_no_name_key"] += 1
                continue
            base = (int(seed.latitude / cell), int(seed.longitude / cell))
            duplicate = False
            for d_lat in (-1, 0, 1):
                for d_lon in (-1, 0, 1):
                    if (base[0] + d_lat, base[1] + d_lon, key_name) in index:
                        duplicate = True
                        break
                if duplicate:
                    break
            if duplicate:
                stats[f"{source}_duplicate"] += 1
                continue
            index[(base[0], base[1], key_name)] = seed.seed_id
            merged.append(seed)
            stats[f"{source}_kept"] += 1
    return merged, dict(stats)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overture-seeds", type=Path, required=True)
    parser.add_argument("--ifas-dir", type=Path)
    parser.add_argument("--osm-csv", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args()

    groups: list[tuple[str, list[Seed]]] = []
    report: dict[str, Any] = {}

    overture = list(read_seeds(arguments.overture_seeds))
    groups.append(("overture", overture))
    report["overture_rows"] = len(overture)

    if arguments.ifas_dir and arguments.ifas_dir.exists():
        ifas, ifas_stats = ifas_rows(arguments.ifas_dir)
        groups.append(("ifas", ifas))
        report["ifas"] = ifas_stats
    if arguments.osm_csv and arguments.osm_csv.exists():
        osm = osm_rows(arguments.osm_csv)
        groups.append(("osm", osm))
        report["osm_rows"] = len(osm)

    merged, dedupe_stats = deduplicate(groups)
    report["dedupe"] = dedupe_stats
    report["merged_rows"] = len(merged)

    merged.sort(key=lambda seed: seed.seed_id)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=SEED_COLUMNS)
        writer.writeheader()
        for seed in merged:
            writer.writerow({column: getattr(seed, column) for column in SEED_COLUMNS})

    if arguments.report:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
