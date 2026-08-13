#!/usr/bin/env python3
"""Overture Maps Places から日本の飲食店 seed を取り出し、検索クエリ文字列を組む。

Overture の住所は品質が一定でない。``freeform`` に都道府県から入っている行もあれば、
丁目だけの行もあり、``locality`` はローマ字で、しかも実際の市区町村と食い違う例が
ある。したがって「住所文字列」は freeform をそのまま使わず、都道府県が含まれるか、
郵便番号で地理を固定できるかを判定して組み立てる。
"""

from __future__ import annotations

import csv
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

PREFECTURE_PATTERN = re.compile(r"(北海道|東京都|京都府|大阪府|..県)")
POSTCODE_PATTERN = re.compile(r"^\s*(\d{3})-?(\d{4})\s*$")
CORPORATE_PREFIX = re.compile(
    r"^(株式会社|有限会社|合同会社|合資会社|一般社団法人|公益社団法人|\(株\)|\(有\))\s*"
)
CORPORATE_SUFFIX = re.compile(
    r"\s*(株式会社|有限会社|合同会社|合資会社|\(株\)|\(有\))\s*$"
)
# 「〒」や住所らしき数字列が名称欄に紛れ込んでいる行があるため、名称側では落とす。
POSTCODE_IN_NAME = re.compile(r"〒\s*\d{3}-?\d{4}")
BRACKET_TAIL = re.compile(r"[（(【\[][^（()）【】\[\]]{1,40}[)）】\]]\s*$")

SEED_COLUMNS = (
    "seed_id",
    "name",
    "name_query",
    "address_query",
    "address_quality",
    "latitude",
    "longitude",
    "postcode",
    "freeform",
    "locality",
    "basic_category",
    "confidence",
    "websites",
)


@dataclass(frozen=True)
class Seed:
    """1件の名寄せ対象。Google 由来の値は一切含まない。"""

    seed_id: str
    name: str
    name_query: str
    address_query: str
    address_quality: str
    latitude: float
    longitude: float
    postcode: str
    freeform: str
    locality: str
    basic_category: str
    confidence: float
    websites: str

    @property
    def eligible(self) -> bool:
        return bool(self.name_query) and bool(self.address_query)


def normalize_name_for_query(value: str) -> str:
    """Google に投げる店名を作る。

    過度に削らないのが要点である。Google の Text Search は表記ゆれに強い一方、
    「本店」「〇〇店」を落とすと支店同士の取り違えが起きる。ここで落とすのは
    検索の邪魔にしかならない法人格・郵便番号・全角記号だけに留める。
    """

    text = unicodedata.normalize("NFKC", value or "")
    text = POSTCODE_IN_NAME.sub(" ", text)
    text = CORPORATE_PREFIX.sub("", text)
    text = CORPORATE_SUFFIX.sub("", text)
    text = text.replace("|", " ").replace("/", " ").replace("　", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def strip_bracket_tail(value: str) -> str:
    """末尾の括弧書き（読み仮名・英字併記）を落とした別表記を返す。"""

    stripped = BRACKET_TAIL.sub("", value).strip()
    return stripped or value


def format_postcode(value: str | None) -> str:
    if not value:
        return ""
    match = POSTCODE_PATTERN.match(value)
    if not match:
        return ""
    return f"{match.group(1)}-{match.group(2)}"


def build_address_query(freeform: str | None, postcode: str | None) -> tuple[str, str]:
    """住所クエリ文字列と、その地理的な確からしさのラベルを返す。

    ``locality`` はローマ字かつ誤りが混ざるため使わない。都道府県が本文に無い場合は
    郵便番号で地理を固定する。どちらも無い行は Query B を成立させられない。
    """

    text = unicodedata.normalize("NFKC", (freeform or "")).strip()
    text = re.sub(r"\s+", " ", text)
    zipcode = format_postcode(postcode)
    has_prefecture = bool(PREFECTURE_PATTERN.search(text))
    if has_prefecture and zipcode:
        return f"〒{zipcode} {text}", "prefecture_and_postcode"
    if has_prefecture:
        return text, "prefecture_only"
    if zipcode and text:
        return f"〒{zipcode} {text}", "postcode_and_partial"
    if zipcode:
        return f"〒{zipcode}", "postcode_only"
    return "", "none"


def overture_seed_query(parquet: Path, *, limit: int | None = None) -> str:
    """Overture parquet から日本の food_and_drink 行を取り出す SQL を返す。"""

    escaped = str(parquet).replace("'", "''")
    tail = f"\nLIMIT {int(limit)}" if limit else ""
    return f"""
        SELECT
          id AS seed_id,
          names.primary AS name,
          coalesce(addresses[1].freeform, '') AS freeform,
          coalesce(addresses[1].postcode, '') AS postcode,
          coalesce(addresses[1].locality, '') AS locality,
          (bbox.ymin + bbox.ymax) / 2 AS latitude,
          (bbox.xmin + bbox.xmax) / 2 AS longitude,
          coalesce(basic_category, '') AS basic_category,
          coalesce(confidence, 0.0) AS confidence,
          coalesce(list_aggregate(websites, 'string_agg', ' '), '') AS websites
        FROM read_parquet('{escaped}')
        WHERE addresses[1].country = 'JP'
          AND list_contains(taxonomy.hierarchy, 'food_and_drink')
          AND names.primary IS NOT NULL
          AND bbox IS NOT NULL{tail}
    """


def row_to_seed(row: dict[str, Any]) -> Seed:
    address_query, quality = build_address_query(row.get("freeform"), row.get("postcode"))
    return Seed(
        seed_id=str(row["seed_id"]),
        name=str(row["name"]),
        name_query=normalize_name_for_query(str(row["name"])),
        address_query=address_query,
        address_quality=quality,
        latitude=float(row["latitude"]),
        longitude=float(row["longitude"]),
        postcode=format_postcode(row.get("postcode")),
        freeform=str(row.get("freeform") or ""),
        locality=str(row.get("locality") or ""),
        basic_category=str(row.get("basic_category") or ""),
        confidence=float(row.get("confidence") or 0.0),
        websites=str(row.get("websites") or ""),
    )


def write_seeds(seeds: list[Seed], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SEED_COLUMNS)
        writer.writeheader()
        for seed in seeds:
            writer.writerow({column: getattr(seed, column) for column in SEED_COLUMNS})


def read_seeds(path: Path) -> Iterator[Seed]:
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            yield Seed(
                seed_id=row["seed_id"],
                name=row["name"],
                name_query=row["name_query"],
                address_query=row["address_query"],
                address_quality=row["address_quality"],
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                postcode=row["postcode"],
                freeform=row["freeform"],
                locality=row["locality"],
                basic_category=row["basic_category"],
                confidence=float(row["confidence"] or 0.0),
                websites=row["websites"],
            )


# -- Google へ送る request body -------------------------------------------------

COMMON_TEXT_BODY: dict[str, Any] = {
    "languageCode": "ja",
    "regionCode": "JP",
    # 曖昧判定に必要なのは「2件以上あるか」なので上限20件は要らない。
    "pageSize": 5,
    "includePureServiceAreaBusinesses": False,
}


def body_query_a(seed: Seed, *, radius_m: float = 150.0, name_query: str | None = None) -> dict[str, Any]:
    """店名 + 自社座標150m bias。"""

    return {
        **COMMON_TEXT_BODY,
        "textQuery": name_query or seed.name_query,
        "locationBias": {
            "circle": {
                "center": {"latitude": seed.latitude, "longitude": seed.longitude},
                "radius": radius_m,
            }
        },
    }


def body_query_b(seed: Seed, *, name_query: str | None = None) -> dict[str, Any]:
    """店名 + 住所文字列、locationBias なし。座標と独立な第2の証拠。"""

    return {
        **COMMON_TEXT_BODY,
        "textQuery": f"{name_query or seed.name_query} {seed.address_query}".strip(),
    }


def body_query_c(
    seed: Seed, *, half_side_m: float = 75.0, name_query: str | None = None
) -> dict[str, Any]:
    """店名 + 座標矩形の locationRestriction。

    ``locationBias`` と違い ``locationRestriction`` は矩形外を実際に切り落とす
    （大阪の店名を東京の矩形で検索すると 0 件になることを確認済み）。したがって
    「この place_id は Google 側でもこの座標の近くにある」ことの裏取りになる。
    Nearby Search と違って店名で絞られるため、密集地でも件数上限に当たらない。
    """

    latitude_delta = half_side_m / 111_320.0
    longitude_delta = half_side_m / (111_320.0 * max(math.cos(math.radians(seed.latitude)), 0.01))
    return {
        **COMMON_TEXT_BODY,
        "textQuery": name_query or seed.name_query,
        "locationRestriction": {
            "rectangle": {
                "low": {
                    "latitude": seed.latitude - latitude_delta,
                    "longitude": seed.longitude - longitude_delta,
                },
                "high": {
                    "latitude": seed.latitude + latitude_delta,
                    "longitude": seed.longitude + longitude_delta,
                },
            }
        },
    }


def body_query_d(
    seed: Seed, *, half_side_m: float = 250.0, name_query: str | None = None
) -> dict[str, Any]:
    """店名 + 住所文字列を、座標矩形の中だけで検索する。

    Query B（住所つき・bias なし）が全国から拾ってしまう遠方の同名店を、矩形で
    物理的に排除した版である。Overture の座標が数十m ずれている行を救うため、
    矩形は probe C より広くとる。
    """

    body = body_query_c(seed, half_side_m=half_side_m, name_query=name_query)
    body["textQuery"] = f"{name_query or seed.name_query} {seed.address_query}".strip()
    return body


def body_nearby(seed: Seed, *, radius_m: float = 40.0, max_results: int = 20) -> dict[str, Any]:
    """座標周辺の place_id 集合。テキストと独立な地理的裏取りに使う。"""

    return {
        "languageCode": "ja",
        "regionCode": "JP",
        "maxResultCount": max_results,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": seed.latitude, "longitude": seed.longitude},
                "radius": radius_m,
            }
        },
    }
