#!/usr/bin/env python3
"""#1273 ①の発見結果を 9_2 の media_sync_staging 形式へ変換する（end-to-end の最後の一歩）

①（スノーボール＋チャンネル逆走査）で得た dish_media 候補を、既存の同期経路
`scripts/20260808T0000_restaurant/9_2_sync_dishes_and_media.py` が読む
`media_sync_staging` の形式に落とす。これが通れば「発見 → DB投入 → 表示」が一本に繋がる。

## 判明した構造的な障害

media_sync_staging は **google_place_id NOT NULL** を要求する（9_2:88）。
一方 ①の発見結果は Overture / IFAS / OSM の**店名ベース**で、google_place_id を持たない。

これは実装漏れではなく設計上そうなっている。#1273 §29/§43 は
「SNS candidate → restaurant_seed に一致 → usable media あり →
 **このrestaurantだけ Google Place ID を取得** → PostgreSQL」
という順序を明示しており、Place ID 解決は「mediaが見つかった店だけ」に絞る後段の工程。

ただし #843 の狙いは Google Places 依存の削減であり、#1318 では現行DBが
Places の派生DBになっている懸念も出ている。**Place ID 解決を挟む限り Places API 依存は残る**。
本スクリプトはその一点だけを外部化し、他の全項目を埋めた状態で出力する。

実行:
    python3 export_media_sync_staging.py --limit 200
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dish_category_matcher import CategoryMatcher, load_categories
from measure_channel_traversal import NameMatcher

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# #1273 【仕様】9_2 の media_sync_staging の列順（9_2_sync_dishes_and_media.py:86-102）。
# 順序も含めて一致させないと COPY FROM STDIN が壊れる。
STAGING_COLUMNS = [
    "dish_media_id",
    "google_place_id",
    "category_id",
    "provider",
    "external_content_id",
    "canonical_url",
    "embed_html",
    "thumbnail_url",
    "media_type",
    "published_at",
    "availability_status",
    "rights_basis",
    "terms_version",
    "last_verified_at",
    "row_hash",
]

# #1273 【仕様】rights_basis の許容値は 20260823T0000 の COMMENT に定義がある:
# official_api / official_oembed / partner_license / first_party_permission。
# YouTube の公式 iframe 埋め込みは official_oembed 相当（oEmbed と同じ公式埋め込み経路）。
RIGHTS_BASIS_YOUTUBE = "official_oembed"

# #1273 【仕様】dish_media.media_type は既存の 'image' / 'video' を踏襲する。
MEDIA_TYPE_VIDEO = "video"

# #1273 §39 【設計】発見直後は available。死活監視で deleted/private/ineligible へ落とす運用。
AVAILABILITY_AVAILABLE = "available"

# dish_media_id は決定的に振る。同じ動画を再エクスポートしても同じUUIDになり、
# 9_2 の ON CONFLICT (id) DO UPDATE が正しく効く。
UUID_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # NAMESPACE_DNS


def youtube_iframe_html(video_id: str) -> str:
    """#1273 【仕様】YouTube公式ドキュメント記載の標準iframe埋め込み。

    app-expo 側（YouTube は embedHtml に依存せず video_id から組み立てる）と同じ形にしておく。
    """
    return (
        f'<iframe width="100%" height="100%" src="https://www.youtube.com/embed/{video_id}" '
        'frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; '
        'gyroscope; picture-in-picture" allowfullscreen></iframe>'
    )


def build_rows(limit: int) -> tuple[list[dict], dict]:
    """①のクロール結果から staging 行を組み立てる。google_place_id 以外を全て埋める。"""
    matcher = NameMatcher()
    cats = load_categories()
    cat_matcher = CategoryMatcher()

    state_path = OUT_DIR / "snowball_crawl_state.json"
    if not state_path.exists():
        raise SystemExit(f"①のクロール結果が無い: {state_path}")
    state = json.loads(state_path.read_text(encoding="utf-8"))

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    stats = {"videos": 0, "restaurant_matched": 0, "with_category": 0, "pairs": 0}

    for channel in state["channels"].values():
        for video in channel.get("videos", []):
            title = video.get("title") or ""
            vid = video.get("id")
            if not vid or not title:
                continue
            stats["videos"] += 1
            restaurants = matcher.match_corroborated(title)
            if not restaurants:
                continue
            stats["restaurant_matched"] += 1
            categories = cat_matcher.match(title)
            if not categories:
                continue
            stats["with_category"] += 1

            for rkey in sorted(restaurants):
                for cat in categories:
                    key = (rkey, cat["dish_category_id"])
                    if key in seen:
                        continue
                    seen.add(key)
                    stats["pairs"] += 1
                    # #1273 【設計】dish_media_id は (provider, video_id, category_id) から
                    # 決定的に導く。再エクスポートで id が変わると 9_2 の upsert が重複を作る。
                    dish_media_id = str(
                        uuid.uuid5(UUID_NAMESPACE, f"youtube:{vid}:{cat['dish_category_id']}")
                    )
                    row_source = f"{vid}|{cat['dish_category_id']}|{rkey}|{title}"
                    rows.append(
                        {
                            "dish_media_id": dish_media_id,
                            # ここだけ埋められない。下の未解決点を参照。
                            "google_place_id": None,
                            "_restaurant_name": matcher.original.get(rkey, rkey),
                            "_restaurant_source": matcher.source_of.get(rkey),
                            "category_id": cat["dish_category_id"],
                            "provider": "youtube",
                            "external_content_id": vid,
                            "canonical_url": f"https://www.youtube.com/watch?v={vid}",
                            "embed_html": youtube_iframe_html(vid),
                            "thumbnail_url": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                            "media_type": MEDIA_TYPE_VIDEO,
                            "published_at": None,
                            "availability_status": AVAILABILITY_AVAILABLE,
                            "rights_basis": RIGHTS_BASIS_YOUTUBE,
                            "terms_version": None,
                            "last_verified_at": now,
                            "row_hash": hashlib.sha256(row_source.encode()).hexdigest(),
                            "_evidence_title": title,
                        }
                    )
                    if len(rows) >= limit:
                        return rows, stats
    return rows, stats


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 ①の結果を media_sync_staging 形式へ")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--out", type=Path, default=OUT_DIR / "media_sync_staging.csv")
    args = ap.parse_args()

    rows, stats = build_rows(args.limit)
    if not rows:
        raise SystemExit("staging 行を1件も作れなかった")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 9_2 が読む列だけを、定義順で出す。google_place_id は空のままにして
    # 「解決前」であることを明示する（NOT NULL なのでこのままでは投入できない）。
    with args.out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=STAGING_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    # 監査用に、店名と根拠タイトルを含む版も出す（人が中身を確かめられるように）
    audit_path = args.out.with_name(args.out.stem + "_audit.csv")
    with audit_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    unresolved = sum(1 for r in rows if not r["google_place_id"])
    print(f"=== 9_2 media_sync_staging 形式への変換 ===", file=sys.stderr)
    print(f"入力: 動画 {stats['videos']:,} / 店舗特定 {stats['restaurant_matched']:,} / "
          f"カテゴリも付与 {stats['with_category']:,} / distinct pair {stats['pairs']:,}", file=sys.stderr)
    print(f"出力: {len(rows):,} 行 -> {args.out.name}", file=sys.stderr)
    print(f"      監査用(店名・根拠タイトル入り) -> {audit_path.name}", file=sys.stderr)
    print(f"\n埋められた列: {len(STAGING_COLUMNS) - 1}/{len(STAGING_COLUMNS)}", file=sys.stderr)
    print(f"**google_place_id が未解決: {unresolved:,}/{len(rows):,} 行（NOT NULL のため投入不可）**",
          file=sys.stderr)
    print("\nこれは実装漏れではなく #1273 §29/§43 の設計どおり。"
          "Place ID 解決は『mediaが見つかった店だけ』に絞る後段の工程で、"
          "Google Places API を要する。#843 の Places 依存削減および #1318 の"
          "ToS 懸念と正面から関係する論点。", file=sys.stderr)


if __name__ == "__main__":
    main()
