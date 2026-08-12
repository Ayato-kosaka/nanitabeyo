"""店舗名寄せで共有する純粋関数。

POCと本番パイプラインで正規化結果がずれると、POCの精度測定が本番に再現されない。
そのためルールを副作用のない関数として切り出し、単体テストで固定する。
"""

from __future__ import annotations

import math
import re
import unicodedata
import uuid
from datetime import date
from typing import Any

PIPELINE_NAMESPACE = uuid.UUID("a6d81aa5-e4a2-4cb4-b80d-a25cb4a66661")

LEGAL_ENTITY_MARKERS = (
    "株式会社",
    "有限会社",
    "合同会社",
    "合資会社",
    "合名会社",
    "一般社団法人",
    "一般財団法人",
    "公益社団法人",
    "公益財団法人",
    "医療法人",
    "社会福祉法人",
    "特定非営利活動法人",
    "npo法人",
    "(株)",
    "(有)",
    "㈱",
    "㈲",
)
STORE_KIND_SUFFIXES = ("本店", "支店", "本館", "別館", "営業所", "店", "店舗")
KANJI_VARIANTS = str.maketrans(
    {"髙": "高", "﨑": "崎", "邊": "辺", "邉": "辺", "濵": "浜", "神": "神"}
)


def normalize_name(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return "".join(character for character in normalized if character.isalnum())


def normalize_name_l1(value: str | None) -> str:
    """料理名を壊さず、法人格と末尾の店舗種別だけを除去する。"""

    normalized = (
        unicodedata.normalize("NFKC", value or "").translate(KANJI_VARIANTS).casefold()
    )
    for marker in LEGAL_ENTITY_MARKERS:
        normalized = normalized.replace(
            unicodedata.normalize("NFKC", marker).casefold(), ""
        )
    normalized = "".join(character for character in normalized if character.isalnum())
    for suffix in sorted(STORE_KIND_SUFFIXES, key=len, reverse=True):
        if normalized.endswith(suffix) and len(normalized) > len(suffix) + 1:
            return normalized[: -len(suffix)]
    return normalized


def normalize_address(value: str | None) -> str:
    normalized = (
        unicodedata.normalize("NFKC", value or "").translate(KANJI_VARIANTS).casefold()
    )
    normalized = re.sub(r"〒?\s*\d{3}[-ー]?\d{4}", "", normalized)
    normalized = (
        normalized.replace("丁目", "-")
        .replace("番地", "-")
        .replace("番", "-")
        .replace("号", "")
    )
    normalized = re.sub(r"[のノ]", "-", normalized)
    normalized = re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠-]+", "", normalized)
    return re.sub(r"-+", "-", normalized).strip("-")


def normalize_phone(value: str | None) -> str | None:
    digits = re.sub(r"\D", "", unicodedata.normalize("NFKC", value or ""))
    if not digits:
        return None
    if digits.startswith("81"):
        return "+" + digits
    if digits.startswith("0"):
        return "+81" + digits[1:]
    return "+81" + digits


def trigram_similarity(left: str, right: str) -> float:
    def trigrams(value: str) -> set[str]:
        padded = f"  {value} "
        return {padded[index : index + 3] for index in range(max(0, len(padded) - 2))}

    left_trigrams, right_trigrams = trigrams(left), trigrams(right)
    if not left_trigrams or not right_trigrams:
        return 0.0
    common = len(left_trigrams & right_trigrams)
    return common / (len(left_trigrams) + len(right_trigrams) - common)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_008.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def parse_float(value: Any) -> float | None:
    try:
        number = float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return number if number is not None and math.isfinite(number) else None


def parse_japanese_date(value: str | None) -> date | None:
    if not value:
        return None
    match = re.search(
        r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})",
        unicodedata.normalize("NFKC", value.strip()),
    )
    if not match:
        return None
    try:
        return date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def deterministic_id(kind: str, *parts: str) -> str:
    """再実行・並列実行でも同じIDになる UUID v5。"""

    key = ":".join([kind, *(part.strip() for part in parts)])
    return str(uuid.uuid5(PIPELINE_NAMESPACE, key))


def build_seed_id(source: str, source_record_id: str) -> str:
    return deterministic_id("restaurant-seed", source, source_record_id)


def build_dish_media_id(provider: str, external_content_id: str) -> str:
    # category_idを含めない。分類先が変わっても既存のlike/impression IDを維持する。
    return deterministic_id("external-dish-media", provider, external_content_id)


def build_attempt_id(run_id: str, seed_id: str, algorithm_version: str) -> str:
    return deterministic_id(
        "google-place-match-attempt", run_id, seed_id, algorithm_version
    )


def s2_cell_id(latitude: float, longitude: float, level: int = 15) -> int:
    """BigQuery S2_CELLIDFROMPOINT と同じ符号付きINT64表現へ変換する。"""

    from s2sphere import CellId, LatLng  # 大容量名寄せ以外では依存を読み込まない

    unsigned = (
        CellId.from_lat_lng(LatLng.from_degrees(latitude, longitude)).parent(level).id()
    )
    return unsigned - 2**64 if unsigned >= 2**63 else unsigned
