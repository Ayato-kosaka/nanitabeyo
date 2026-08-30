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
# 仮名・漢字を含むかどうか。locality がローマ字表記の行を弾くために使う。
JAPANESE_PATTERN = re.compile(r"[぀-ヿ一-鿿]")
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
        """住所テキストのクエリ（B）まで組める行。

        住所が無くても座標があれば矩形の証拠は作れるので、これは「A と B の
        両方を投げられるか」であって「名寄せできるか」ではない。
        ``rule_box_unique`` は B を必須にしていないため、判定側は
        ``eligible_by_coordinates`` を見る。
        """

        return bool(self.name_query) and bool(self.address_query)

    @property
    def eligible_by_coordinates(self) -> bool:
        """座標だけで矩形の証拠を作れる行。

        OSM は住所タグが付いている行が実測で 15.6% しかない。住所が無いという
        理由でこれらを丸ごと落とすと、そもそも OSM を足した意味が無くなる。
        店名と座標さえあれば A と矩形は投げられる。
        """

        return bool(self.name_query)


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


def expand_postcode(postcode: str | None) -> tuple[str, str, str] | None:
    """郵便番号を 都道府県・市区町村・町域 へ展開する。

    Overture の ``freeform`` は 62% しか都道府県を含まず、``locality`` は誤りが
    混ざる（郵便番号 115-0042 の「志茂」の行が locality=Ogasawara-mura になっていた）。
    郵便番号は 89% の行にあり、posuto が同梱する日本郵便由来のDBで完全にオフラインで
    引ける。したがって、住所文字列の地理は郵便番号から作り直すのが最も確かである。
    """

    digits = normalize_postcode_digits(postcode)
    if not digits:
        return None
    try:
        import posuto
    except ImportError as error:  # pragma: no cover - 環境依存
        raise SystemExit("posuto が必要。python -m pip install -r requirements.txt") from error
    try:
        record = posuto.get(digits)
    except Exception:
        # 郵便番号が実在しない・廃止済みの行。地理は他の手段へ委ねる。
        return None
    return (record.prefecture or "", record.city or "", record.neighborhood or "")


def normalize_postcode_digits(value: str | None) -> str | None:
    """郵便番号から数字7桁を取り出す。

    全角（１５０ｰ００４４）や、ハイフンの代わりに長音記号が入った 542ー0083 の
    ような行が実データに存在するため、NFKC のあとで区切り文字を潰してから抜く。
    """

    if not value:
        return None
    text = unicodedata.normalize("NFKC", value)
    text = text.replace("ー", "-").replace("−", "-").replace("‐", "-")
    digits = re.sub(r"\D", "", text)
    return digits if len(digits) == 7 else None


def strip_leading_geography(text: str, municipality: str) -> str:
    """freeform の先頭にある市区町村名や都道府県の残骸を落とす。

    freeform は「大阪市鶴見区横堤1丁目11-126」のように市区町村から始まる行が多く、
    郵便番号から作った「大阪府大阪市鶴見区」を前置すると市区町村が二重になる。
    「県神戸市東灘区…」のように都道府県の末尾一文字だけが残っている行もある。
    """

    cleaned = text.lstrip("都道府県 ")
    if municipality and cleaned.startswith(municipality):
        cleaned = cleaned[len(municipality) :]
    else:
        # 政令市は「大阪市」+「鶴見区」の二段。市までしか一致しない行にも対応する。
        city_head = re.split(r"(?<=市)", municipality, maxsplit=1)[0] if municipality else ""
        if city_head and city_head != municipality and cleaned.startswith(city_head):
            cleaned = cleaned[len(city_head) :]
    return cleaned.lstrip() or text


def build_address_query(
    freeform: str | None, postcode: str | None, locality: str | None = None
) -> tuple[str, str]:
    """住所クエリ文字列と、その地理的な確からしさのラベルを返す。

    当初は ``locality`` を「ローマ字で誤りが混ざる」として捨てていたが、実測すると
    日本語の市区町村名が 789,612行中 776,351行（98.3%）に入っている。捨てていたのは
    過剰反応で、住所も郵便番号も無い行にとって locality は唯一の地理情報である。
    そこで、都道府県・郵便番号がある行では従来どおりそれらを優先し、どちらも無い
    行に限って locality を補う。ローマ字や誤りが混ざる分は、この順序で吸収する。
    """

    text = unicodedata.normalize("NFKC", (freeform or "")).strip()
    text = re.sub(r"\s+", " ", text)
    city = unicodedata.normalize("NFKC", (locality or "")).strip()
    # ローマ字の locality は Google 検索の役に立たないうえ誤りも多いので使わない。
    if not JAPANESE_PATTERN.search(city):
        city = ""
    has_prefecture = bool(PREFECTURE_PATTERN.search(text))
    if has_prefecture:
        return text, "prefecture_in_freeform"

    # 郵便番号から都道府県・市区町村・町域を作り直す。生の〒番号をそのまま投げるより、
    # 展開した住所文字列のほうが Text Search の手掛かりになる。
    expanded = expand_postcode(postcode)
    if expanded:
        prefecture, municipality, neighborhood = expanded
        head = f"{prefecture}{municipality}"
        # freeform がある行では町域名を足さない。郵便番号の町域と freeform の町名は
        # 食い違うことがあり（「殿町」+「田村町235-1」）、両方並べると矛盾した住所に
        # なる。市区町村までを冠すれば住所は一意に定まるので、そこで止める。
        if text:
            trimmed = strip_leading_geography(text, municipality)
            return f"{head}{trimmed}", "postcode_expanded_and_partial"
        return f"{head}{neighborhood}", "postcode_expanded"

    if city and text:
        return f"{city} {text}", "locality_and_partial"
    if city:
        return city, "locality_only"
    return "", "none"


# 飲食店として扱う basic_category。taxonomy に food_and_drink が付いていない行でも、
# これらに該当すれば店として Google に載りうる。
FOOD_CATEGORIES = (
    "restaurant", "bar", "cafe", "casual_eatery", "coffee_shop",
    "food_and_beverage_store", "bakery", "dessert_shop", "pub", "fast_food_restaurant",
)
# 日本の座標の範囲。南西諸島から北海道まで。
JAPAN_BBOX = (122.0, 154.0, 20.0, 46.5)


def overture_seed_query(parquet: Path, *, limit: int | None = None) -> str:
    """Overture parquet から日本の飲食店行を取り出す SQL を返す。

    当初は ``addresses[1].country = 'JP'`` で日本を絞っていたが、これは住所が
    付いていない行を丸ごと落としていた。実測で 789,612 行に対し、座標で絞ると
    1,012,263 行あり、**22%を捨てていた**。住所はクエリBを組むのに使うだけで、
    店名と座標があれば ``box_unique`` は判定できる（B は必須ではない）。

    カテゴリも taxonomy の food_and_drink だけでなく basic_category も見る。
    パン屋や菓子店は taxonomy が付いていないことがあり、これで 1,081,471 行になる。
    """

    escaped = str(parquet).replace("'", "''")
    tail = f"\nLIMIT {int(limit)}" if limit else ""
    categories = ", ".join(f"'{name}'" for name in FOOD_CATEGORIES)
    west, east, south, north = JAPAN_BBOX
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
        WHERE bbox.xmin BETWEEN {west} AND {east}
          AND bbox.ymin BETWEEN {south} AND {north}
          AND (
            list_contains(taxonomy.hierarchy, 'food_and_drink')
            OR basic_category IN ({categories})
          )
          AND names.primary IS NOT NULL
          AND bbox IS NOT NULL{tail}
    """


def row_to_seed(row: dict[str, Any]) -> Seed:
    address_query, quality = build_address_query(
        row.get("freeform"), row.get("postcode"), row.get("locality")
    )
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
    # 上限20件は5件と同じ1回分の課金イベントで、料金は変わらない（IDs Only は $0.00）。
    # 5件だと「候補がちょうど5件」と「60件」を区別できず、曖昧さを取りこぼす。
    "pageSize": 20,
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


def rectangle(seed: Seed, half_side_m: float) -> dict[str, Any]:
    """座標を中心にした一辺 2×half_side_m の矩形。"""

    latitude_delta = half_side_m / 111_320.0
    longitude_delta = half_side_m / (111_320.0 * max(math.cos(math.radians(seed.latitude)), 0.01))
    return {
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
    }


def body_query_ca(seed: Seed, *, half_side_m: float = 1000.0) -> dict[str, Any]:
    """店名 + 住所文字列を、座標矩形の locationRestriction の中で引く。

    B（店名+住所、bias なし）は座標と独立に効く強い証拠だが、同名チェーンの
    別店舗を引くことがある。矩形で囲えば「住所文字列でも一致し、かつ座標の
    近くにある」を1回のリクエストで確かめられる。座標がずれている行を救うため、
    矩形は広め（既定 ±1km）に取る。
    """

    return {
        **COMMON_TEXT_BODY,
        "textQuery": f"{seed.name_query} {seed.address_query}".strip(),
        "locationRestriction": rectangle(seed, half_side_m),
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
