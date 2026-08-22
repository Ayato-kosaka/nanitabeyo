#!/usr/bin/env python3
"""#1273 Round3: 発見した動画から dish_media 候補行を実際に組み立てる

ここまでの計測は「restaurant を発見できたか」しか見ていなかったが、①のゴールは
**restaurant × dish_category × media** の3つ組（= dish_media）を作ることである。
動画が店舗を名指ししていても、134カテゴリのどれかを特定できなければ dish_media にならない。

本スクリプトは、既にキャッシュ済みの動画タイトル（チャンネル逆走査で列挙したもの）に対して
  1. restaurant 逆引き（NameMatcher v3、locality/region の裏取り必須）
  2. dish_category 付与（134カテゴリの label_ja とその表記ゆれ）
を両方かけ、成立した3つ組の数と歩留まりを出す。

**ネットワークアクセスは一切行わない**（out/*_cache.json のタイトルのみを読む）。

実行:
    python3 measure_dish_media_yield.py
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dish_category_matcher import CategoryMatcher, load_categories as _shared_load_categories
from measure_channel_traversal import NameMatcher, normalize_ja

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
CACHES = ("out/channel_crawl_cache.json", "out/channel_titles_cache.json")

# #1311 【設計】旧実装の手書き変種。dish_category_matcher.VARIANTS に置き換え済みで
# 現在は参照されない。当時の再現用に残している。
EXTRA_VARIANTS: dict[str, tuple[str, ...]] = {
    "ラーメン": ("らーめん", "拉麺", "中華そば", "ラーメン"),
    "そば": ("蕎麦", "そば"),
    "うどん": ("饂飩", "うどん"),
    "寿司": ("すし", "鮨", "スシ", "寿司"),
    "焼き鳥": ("焼鳥", "やきとり", "焼き鳥"),
    "焼肉": ("焼き肉", "やきにく", "焼肉"),
    "餃子": ("ぎょうざ", "ギョーザ", "餃子"),
    "カレー": ("カリー", "curry", "カレー"),
    "天ぷら": ("天麩羅", "てんぷら", "天ぷら"),
    "お好み焼き": ("お好み焼", "おこのみやき", "お好み焼き"),
    "とんかつ": ("豚カツ", "トンカツ", "とんかつ"),
    "パンケーキ": ("ホットケーキ", "パンケーキ"),
}


def load_categories() -> list[dict]:
    """134 gate カテゴリを読む。

    # #1311 【設計】旧実装は EXTRA_VARIANTS（12ラベル分の手書き）だけで、付与率が 62.3% で
    # 頭打ちだった。実データ由来の変種辞書と span 包含による衝突解消を入れた
    # dish_category_matcher に置き換え、72.5%（+10.86pp、目視15/15）まで改善している。
    """
    return _shared_load_categories()


_CATEGORY_MATCHER: CategoryMatcher | None = None


def match_categories(cats: list[dict], text: str) -> list[dict]:
    """タイトルから 134カテゴリを引き当てる。複数該当しうる（#1273 §24 の多対多）。

    cats 引数は後方互換のために残しているが、判定は共有マッチャが持つ辞書で行う。
    """
    global _CATEGORY_MATCHER
    if _CATEGORY_MATCHER is None:
        _CATEGORY_MATCHER = CategoryMatcher()
    return _CATEGORY_MATCHER.match(text)


def load_cached_videos() -> list[dict]:
    videos: dict[str, dict] = {}
    for rel in CACHES:
        p = HERE / rel
        if not p.exists():
            continue
        cache = json.loads(p.read_text(encoding="utf-8"))
        for c in cache.get("channels", []):
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    videos.setdefault(v["id"], {"id": v["id"], "title": v["title"],
                                                "channel": c.get("channel"),
                                                "channel_id": c.get("channel_id")})
    return list(videos.values())


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 dish_media candidate yield (offline)")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "dish_media_yield.json")
    args = ap.parse_args()

    matcher = NameMatcher()
    cats = load_categories()
    videos = load_cached_videos()
    if not videos:
        raise SystemExit("キャッシュが無い。先に measure_channel_crawl.py 等を実行すること。")
    print(f"[input] キャッシュ済み動画 {len(videos):,} 本（ネットワークアクセスなし）", file=sys.stderr)

    n_rest = n_cat = n_both = 0
    triples: set[tuple[str, str]] = set()
    rows = []
    cat_counter: collections.Counter = collections.Counter()
    for v in videos:
        rests = matcher.match_corroborated(v["title"])
        cs = match_categories(cats, v["title"])
        if rests:
            n_rest += 1
        if cs:
            n_cat += 1
        if not rests or not cs:
            continue
        n_both += 1
        for rkey in rests:
            for c in cs:
                triples.add((rkey, c["dish_category_id"]))
                cat_counter[c["label_ja"]] += 1
                if len(rows) < 3000:
                    rows.append({
                        "google_place_id": None,  # #1273 §29 publish直前に解決する想定
                        "restaurant_name": matcher.original.get(rkey, rkey),
                        "source": matcher.source_of.get(rkey),
                        "category_id": c["dish_category_id"],
                        "category_ja": c["label_ja"],
                        "provider": "youtube",
                        "external_content_id": v["id"],
                        "canonical_url": f"https://www.youtube.com/watch?v={v['id']}",
                        "discovery_method": "youtube_channel_traversal",
                        "evidence_title": v["title"],
                        "channel": v["channel"],
                    })

    distinct_rest = len({r for r, _ in triples})
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "input": "チャンネル逆走査でキャッシュ済みの動画タイトルのみ（ネットワーク不使用）",
            "restaurant": "NameMatcher v3 (locality/region 裏取り必須, 実測precision約100%)",
            "category": "134カテゴリの label_ja + 最小限の表記ゆれ。"
                        "本番の dish_category_variants を使っていないため付与率は下限",
            "sources": matcher.sources_used,
        },
        "funnel": {
            "videos": len(videos),
            "restaurant_matched": n_rest,
            "category_matched": n_cat,
            "both": n_both,
            "restaurant_rate": n_rest / len(videos),
            "category_rate": n_cat / len(videos),
            "both_rate": n_both / len(videos),
            "category_given_restaurant": n_both / n_rest if n_rest else 0,
        },
        "dish_media": {
            "distinct_restaurant_x_category": len(triples),
            "distinct_restaurants": distinct_rest,
            "categories_per_restaurant": len(triples) / distinct_rest if distinct_rest else 0,
            "distinct_categories_used": len(cat_counter),
        },
        "top_categories": cat_counter.most_common(15),
        "sample_rows": rows[:200],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    f = result["funnel"]
    print(f"\n=== dish_media funnel（キャッシュ済み {f['videos']:,} 本）===", file=sys.stderr)
    print(f"  restaurant 特定        : {f['restaurant_matched']:6,} ({f['restaurant_rate']:.1%})", file=sys.stderr)
    print(f"  category   特定        : {f['category_matched']:6,} ({f['category_rate']:.1%})", file=sys.stderr)
    print(f"  両方成立(=dish_media化): {f['both']:6,} ({f['both_rate']:.1%})", file=sys.stderr)
    print(f"  店舗特定できた動画のうちcategoryも付いた割合: {f['category_given_restaurant']:.1%}", file=sys.stderr)
    d = result["dish_media"]
    print(f"\n  distinct restaurant x category = {d['distinct_restaurant_x_category']:,}", file=sys.stderr)
    print(f"  distinct restaurants           = {d['distinct_restaurants']:,}", file=sys.stderr)
    print(f"  1店舗あたりカテゴリ数 m        = {d['categories_per_restaurant']:.2f}", file=sys.stderr)
    print(f"  使われたカテゴリ数             = {d['distinct_categories_used']}/134", file=sys.stderr)
    print(f"\n  上位カテゴリ: {', '.join(f'{k}({v})' for k, v in result['top_categories'][:8])}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
