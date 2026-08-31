"""SNS料理媒体の入力検証。

このモジュールは投稿を発見・scrapeしない。別途、利用規約と権利を確認して取得した
CSV/NDJSONを「公開候補」へ入れる前に、最低限の契約を検証する。
"""

from __future__ import annotations

import csv
import json
from collections.abc import Iterator, Mapping
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from normalization import build_dish_media_id

PROVIDER_HOSTS = {
    "instagram": {"instagram.com", "www.instagram.com"},
    "tiktok": {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com"},
    "x": {"x.com", "www.x.com", "twitter.com", "www.twitter.com"},
}
ALLOWED_RIGHTS_BASES = {
    "official_api",
    "official_oembed",
    "partner_license",
    "first_party_permission",
}
ALLOWED_AVAILABILITY = {"available", "unavailable", "deleted", "private"}
ALLOWED_MEDIA_TYPES = {"image", "video"}
MAX_URL_LENGTH = 4_096
MAX_EMBED_HTML_LENGTH = 1_000_000


def parse_optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise ValueError(f"confidenceは0〜1です: {value!r}")
    return number


def parse_optional_timestamp(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def validate_canonical_url(provider: str, value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) > MAX_URL_LENGTH:
        raise ValueError(f"canonical_urlは{MAX_URL_LENGTH}文字以内にしてください")
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("canonical_urlはHTTPSの絶対URLにしてください")
    if parsed.username or parsed.password:
        raise ValueError("canonical_urlにcredentialを含められません")
    allowed = PROVIDER_HOSTS[provider]
    if parsed.hostname.casefold() not in allowed:
        raise ValueError(
            f"provider={provider} とURL host={parsed.hostname}が一致しません"
        )
    return cleaned


def validate_optional_https_url(field_name: str, value: Any) -> str | None:
    """thumbnail等の任意URLでもcredential・非HTTPSを受け口で拒否する。"""

    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    if len(cleaned) > MAX_URL_LENGTH:
        raise ValueError(f"{field_name}は{MAX_URL_LENGTH}文字以内にしてください")
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"{field_name}はHTTPSの絶対URLにしてください")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name}にcredentialを含められません")
    return cleaned


def normalize_input_row(
    source: Mapping[str, Any],
    *,
    run_id: str,
    observed_date: date,
    observed_at: datetime | None = None,
) -> dict[str, Any]:
    provider = str(source.get("provider") or "").strip().casefold()
    if provider == "twitter":
        provider = "x"
    if provider not in PROVIDER_HOSTS:
        raise ValueError(f"未対応providerです: {provider!r}")

    external_content_id = str(source.get("external_content_id") or "").strip()
    if not external_content_id or len(external_content_id) > 512:
        raise ValueError("external_content_idは1〜512文字で必須です")
    canonical_url = validate_canonical_url(
        provider, str(source.get("canonical_url") or "")
    )
    media_type = str(source.get("media_type") or "").strip().casefold()
    if media_type not in ALLOWED_MEDIA_TYPES:
        raise ValueError(f"media_typeが不正です: {media_type!r}")
    rights_basis = str(source.get("rights_basis") or "").strip().casefold()
    if rights_basis not in ALLOWED_RIGHTS_BASES:
        raise ValueError(
            "rights_basisはofficial_api / official_oembed / partner_license / "
            "first_party_permissionのいずれかです"
        )
    availability = (
        str(source.get("availability_status") or "available").strip().casefold()
    )
    if availability not in ALLOWED_AVAILABILITY:
        raise ValueError(f"availability_statusが不正です: {availability!r}")

    google_place_id = str(source.get("google_place_id") or "").strip() or None
    category_id = str(source.get("category_id") or "").strip() or None
    embed_html = str(source.get("embed_html") or "").strip() or None
    if embed_html and len(embed_html) > MAX_EMBED_HTML_LENGTH:
        raise ValueError(f"embed_htmlは{MAX_EMBED_HTML_LENGTH}文字以内にしてください")
    row = {
        "observed_date": observed_date.isoformat(),
        "run_id": run_id,
        "dish_media_id": build_dish_media_id(provider, external_content_id),
        "provider": provider,
        "external_content_id": external_content_id,
        "canonical_url": canonical_url,
        # embed_htmlはrawとして保持するだけ。公開時はprovider allowlistとCSPを通す。
        "embed_html": embed_html,
        "thumbnail_url": validate_optional_https_url(
            "thumbnail_url", source.get("thumbnail_url")
        ),
        "media_type": media_type,
        "published_at": parse_optional_timestamp(source.get("published_at")),
        "google_place_id": google_place_id,
        "restaurant_match_method": str(
            source.get("restaurant_match_method") or ""
        ).strip()
        or None,
        "restaurant_match_confidence": parse_optional_float(
            source.get("restaurant_match_confidence")
        ),
        "category_id": category_id,
        "category_match_method": str(source.get("category_match_method") or "").strip()
        or None,
        "category_confidence": parse_optional_float(source.get("category_confidence")),
        "availability_status": availability,
        "rights_basis": rights_basis,
        "terms_version": str(source.get("terms_version") or "").strip() or None,
        "raw_payload_json": str(source.get("raw_payload_json") or "").strip() or None,
        # 同じ入力fileの全行は同じ観測時刻にする。1投稿に複数category候補が
        # ある場合も「最新観測」をひとまとまりとして再現できる。
        "observed_at": (observed_at or datetime.now(timezone.utc)).isoformat(),
    }
    # available行は公開候補の結合キーとconfidenceを必須にする。削除/private観測は
    # IDとURLだけでも受け付け、既存catalogから落とすためのtombstoneとして使う。
    if availability == "available":
        required = {
            "embed_html": embed_html,
            "google_place_id": google_place_id,
            "restaurant_match_confidence": row["restaurant_match_confidence"],
            "category_id": category_id,
            "category_confidence": row["category_confidence"],
        }
        missing = [key for key, value in required.items() if value is None]
        if missing:
            raise ValueError(f"available行の必須項目がありません: {', '.join(missing)}")
    return row


def iter_input_rows(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix.casefold() in {".ndjson", ".jsonl"}:
        with path.open(encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if line.strip():
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError as error:
                        raise ValueError(
                            f"{path}:{line_number}: JSONが不正です"
                        ) from error
                    if not isinstance(value, dict):
                        raise ValueError(f"{path}:{line_number}: objectが必要です")
                    yield value
        return
    if path.suffix.casefold() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)
        return
    raise ValueError("入力は.csv/.ndjson/.jsonlのいずれかです")
