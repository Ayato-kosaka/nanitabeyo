#!/usr/bin/env python3
"""#1273 Round3 アイデアA-3: スノーボール式のチャンネル発見

measure_channel_crawl.py で、チャンネル逆走査の飽和は緩やか(Heaps則の指数0.782、
10,000ch で約78,000店)である一方、**チャンネル発見効率が 0.33 ch/クエリ**しかなく、
1チャンネル増やすのに検索3回かかることが分かった。全体のコストはここで決まる。

改善案: カテゴリ×エリアで闇雲に検索するのではなく、**既に発見した店舗名で検索する**。
その店は既に「動画に撮られた実績のある店」なので、検索すれば必ず何かしら当たり、
しかも同じ店を撮った**別の**グルメチャンネルが芋づる式に出てくるはず。

本スクリプトは 2つの発見経路の ch/クエリ を同一条件で比較する:
  - baseline : カテゴリ×エリア検索（measure_channel_crawl.py と同じ）
  - snowball : 既知店舗名での検索

実行:
    python3 measure_channel_snowball.py --probes 80
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from measure_channel_traversal import NameMatcher, normalize_ja, yt_json

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"


def known_restaurants(matcher: NameMatcher, limit: int) -> list[tuple[str, str]]:
    """これまでの逆走査で発見済みの店舗を、検索プローブの種として取り出す。

    戻り値: [(元の店名, locality)]。locality はクエリの曖昧性を減らすために付ける。
    """
    seen: set[str] = set()
    for path in ("out/channel_crawl_cache.json", "out/channel_titles_cache.json"):
        p = HERE / path
        if not p.exists():
            continue
        cache = json.loads(p.read_text(encoding="utf-8"))
        for c in cache.get("channels", []):
            for v in c.get("videos", []):
                seen |= matcher.match_corroborated(v.get("title") or "")
    # 決定的に選ぶ
    keys = sorted(seen, key=lambda k: hashlib.sha256(k.encode()).hexdigest())[:limit]
    out = []
    for k in keys:
        loc, _region = matcher.area.get(k, ("", ""))
        out.append((matcher.original.get(k, k), loc))
    return out


def baseline_queries(limit: int) -> list[str]:
    """比較用: カテゴリ×エリア検索。measure_channel_crawl.py と同じ作り方。"""
    csv.field_size_limit(10**7)
    import collections

    by_region: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    with (FIXTURES / "overture_jp_food.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            region = (r.get("region") or "").strip()
            loc = (r.get("locality") or "").strip()
            if region and loc:
                by_region[region][loc] += 1
    areas = [c.most_common(1)[0][0] for c in by_region.values() if c]
    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))
    top = [c["label_ja"] for c in cats[:20]]
    # crawl 側が使った先頭を避け、後ろからずらして別のセルを引く
    return [f"{top[(i + 7) % len(top)]} {areas[(i + 13) % len(areas)]}" for i in range(limit)]


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Round3 A-3: snowball channel discovery")
    ap.add_argument("--probes", type=int, default=80, help="各経路のクエリ本数")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "channel_snowball.json")
    args = ap.parse_args()

    matcher = NameMatcher()

    # 既知チャンネル（これを「新規」の判定基準にする）
    known_channels: set[str] = set()
    for path in ("out/channel_crawl_cache.json", "out/channel_titles_cache.json"):
        p = HERE / path
        if p.exists():
            cache = json.loads(p.read_text(encoding="utf-8"))
            known_channels |= {c["channel_id"] for c in cache.get("channels", [])}
            for row in cache.get("seeds", []):
                known_channels |= {e["channel_id"] for e in row.get("entries", []) if e.get("channel_id")}
    print(f"[known] 既知チャンネル {len(known_channels)}", file=sys.stderr)

    probes = known_restaurants(matcher, args.probes)
    print(f"[snowball] 既知店舗 {len(probes)} 件をプローブに使う", file=sys.stderr)
    snow_queries = [f"{name} {loc}".strip() for name, loc in probes]
    base_queries = baseline_queries(args.probes)

    def run(query: str) -> dict:
        data, err = yt_json(f"ytsearch10:{query}", [], 120)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        chans, rests = set(), set()
        for e in entries:
            names = matcher.match_corroborated(e.get("title") or "")
            if names:
                rests |= names
                if e.get("channel_id"):
                    chans.add(e["channel_id"])
        return {"query": query, "error": err, "n_entries": len(entries),
                "channels": sorted(chans), "restaurants": sorted(rests)}

    results = {}
    for label, queries in (("snowball", snow_queries), ("baseline", base_queries)):
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            rows = list(pool.map(run, queries))
        ok = [r for r in rows if not r["error"]]
        all_ch = {c for r in ok for c in r["channels"]}
        new_ch = all_ch - known_channels
        all_rest = {x for r in ok for x in r["restaurants"]}
        results[label] = {
            "queries_ok": len(ok),
            "channels_found": len(all_ch),
            "channels_new": len(new_ch),
            "channels_new_per_query": len(new_ch) / max(len(ok), 1),
            "restaurants_found": len(all_rest),
            "restaurants_per_query": len(all_rest) / max(len(ok), 1),
            "zero_channel_rate": sum(1 for r in ok if not r["channels"]) / max(len(ok), 1),
            "rows": rows,
        }
        print(f"  {label:9s} {len(ok)} クエリ -> 新規ch {len(new_ch):3d} "
              f"({len(new_ch)/max(len(ok),1):.2f}/クエリ)  店舗 {len(all_rest):3d} "
              f"({len(all_rest)/max(len(ok),1):.2f}/クエリ)", file=sys.stderr)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "matcher": "NameMatcher v3 (locality/region 裏取り必須)",
            "snowball": "既に発見済みの店舗名+localityで ytsearch10",
            "baseline": "カテゴリ×エリアで ytsearch10",
            "known_channels_at_start": len(known_channels),
        },
        "results": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    s, b = results["snowball"], results["baseline"]
    print(f"\n=== チャンネル発見効率 ===", file=sys.stderr)
    print(f"  baseline (カテゴリ×エリア): {b['channels_new_per_query']:.2f} 新規ch/クエリ", file=sys.stderr)
    print(f"  snowball (既知店舗名)     : {s['channels_new_per_query']:.2f} 新規ch/クエリ", file=sys.stderr)
    if b["channels_new_per_query"]:
        print(f"  -> {s['channels_new_per_query']/b['channels_new_per_query']:.1f}倍", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
