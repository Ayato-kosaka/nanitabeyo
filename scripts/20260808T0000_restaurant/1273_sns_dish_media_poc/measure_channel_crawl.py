#!/usr/bin/env python3
"""#1273 Round3 アイデアA-2: チャンネル逆走査のスケール則を測る

measure_channel_traversal.py で「チャンネル逆走査は検索の28倍/コール、
チャンネル間重複はわずか5.5%」を実測した。残る問いは1つ:

    **チャンネルを増やし続けたとき、どこで飽和するか。**

ここが分かれば ①(SNSから無料でdish_mediaを発見する方法の確立) の
全国到達可能性を数字で出せる。逆に分からないと、S=17.9%(検索経由の実測)が
過小評価なのかどうかも判定できない。

構成:
  1. 全国47都道府県 x 人気カテゴリで種クエリを撒き、店舗を名指しした動画の
     チャンネルを収集する（1クエリあたり何チャンネル見つかるか＝チャンネル供給率）
  2. 見つけたチャンネルを順に逆走査し、累積 distinct 店舗数の曲線を描く
  3. 曲線の形から、チャンネル数を増やしたときの到達点を外挿する

逆引きは measure_channel_traversal.NameMatcher(v3, locality/region の裏取り必須、
実測 precision 約100%)をそのまま使う。

実行:
    python3 measure_channel_crawl.py --seed-queries 150 --max-channels 150
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from measure_channel_traversal import (
    MAX_VIDEOS_PER_CHANNEL,
    NameMatcher,
    yt_json,
)

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"


def build_seed_queries(n: int) -> list[str]:
    """全国に散らばる種クエリを決定的に作る。

    チャンネルの地域偏りを避けたいので、Overture の region(都道府県)ごとに
    最大の locality を1つ取り、人気カテゴリと総当たりで組む。
    """
    csv.field_size_limit(10**7)
    by_region: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    with (FIXTURES / "overture_jp_food.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            region = (r.get("region") or "").strip()
            loc = (r.get("locality") or "").strip()
            if region and loc:
                by_region[region][loc] += 1
    # region が空の行が多いので、locality だけで規模上位も混ぜる
    areas = [c.most_common(1)[0][0] for c in by_region.values() if c]
    if not areas:
        raise SystemExit("region/locality を持つ行が無い")

    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))
    top = [c["label_ja"] for c in cats[:20]]

    queries = []
    i = 0
    while len(queries) < n:
        q = f"{top[i % len(top)]} {areas[i % len(areas)]}"
        if q not in queries:
            queries.append(q)
        i += 1
        if i > n * 20:
            break
    return queries


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Round3 A-2: channel crawl scale law")
    ap.add_argument("--seed-queries", type=int, default=150)
    ap.add_argument("--max-channels", type=int, default=150)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "channel_crawl.json")
    ap.add_argument("--cache", type=Path, default=HERE / "out" / "channel_crawl_cache.json")
    args = ap.parse_args()

    matcher = NameMatcher()
    cache: dict = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache.exists() else {}

    # --- 1. 種まき: 全国に散らばるクエリでチャンネルを集める ---
    queries = build_seed_queries(args.seed_queries)
    print(f"[seed] {len(queries)} queries across {len({q.split()[-1] for q in queries})} areas", file=sys.stderr)

    def seed_work(q: str) -> dict:
        data, err = yt_json(f"ytsearch10:{q}", [], 120)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {"query": q, "error": err,
                "entries": [{"title": e.get("title"), "channel_id": e.get("channel_id"),
                             "channel": e.get("channel") or e.get("uploader")} for e in entries]}

    if "seeds" in cache and len(cache["seeds"]) >= len(queries):
        seed_rows = cache["seeds"][: len(queries)]
        print("[cache] 種クエリはキャッシュを使用", file=sys.stderr)
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            seed_rows = list(pool.map(seed_work, queries))
        cache["seeds"] = seed_rows
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    # 店舗を名指しした動画を出したチャンネルだけを候補にする
    candidates: dict[str, dict] = {}
    seed_restaurants: set[str] = set()
    seed_ok = 0
    for row in seed_rows:
        if row["error"]:
            continue
        seed_ok += 1
        for e in row["entries"]:
            names = matcher.match_corroborated(e.get("title") or "")
            if names:
                seed_restaurants |= names
                if e.get("channel_id"):
                    c = candidates.setdefault(e["channel_id"], {"channel": e["channel"], "hits": 0})
                    c["hits"] += 1
    print(f"[seed] {seed_ok} queries -> {len(candidates)} channels, "
          f"{len(seed_restaurants)} restaurants "
          f"({len(candidates)/max(seed_ok,1):.2f} channels/query)", file=sys.stderr)

    # --- 2. 逆走査 ---
    ranked = sorted(candidates.items(), key=lambda kv: (-kv[1]["hits"], kv[0]))[: args.max_channels]

    def fetch(item: tuple[str, dict]) -> dict:
        cid, meta = item
        data, err = yt_json(f"https://www.youtube.com/channel/{cid}/videos",
                            ["--playlist-end", str(MAX_VIDEOS_PER_CHANNEL)], 300)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {"channel_id": cid, "channel": meta["channel"], "hits": meta["hits"], "error": err,
                "videos": [{"id": e.get("id"), "title": e.get("title")} for e in entries]}

    cached_ch = {c["channel_id"]: c for c in cache.get("channels", [])}
    todo = [item for item in ranked if item[0] not in cached_ch]
    fetched = list(cached_ch[cid] for cid, _ in ranked if cid in cached_ch)
    if todo:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            fetched += list(pool.map(fetch, todo))
        cache["channels"] = list({c["channel_id"]: c for c in list(cached_ch.values()) + fetched}.values())
        args.cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    # --- 3. 飽和曲線 ---
    ok = [c for c in fetched if not c["error"] and c["videos"]]
    ok.sort(key=lambda c: (-c["hits"], c["channel_id"]))  # 決定的な順序で累積する
    seen: set[str] = set()
    curve = []
    rows = []
    for c in ok:
        found: set[str] = set()
        for v in c["videos"]:
            found |= matcher.match_corroborated(v.get("title") or "")
        new = found - seen
        seen |= found
        curve.append(len(seen))
        rows.append({"channel": c["channel"], "channel_id": c["channel_id"],
                     "n_videos": len(c["videos"]), "n_found": len(found), "n_new": len(new)})

    n = len(ok)
    first_q = sum(r["n_new"] for r in rows[: max(1, n // 4)]) / max(1, n // 4)
    last_q = sum(r["n_new"] for r in rows[-max(1, n // 4):]) / max(1, n // 4)
    total_videos = sum(len(c["videos"]) for c in ok)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "matcher": "measure_channel_traversal.NameMatcher v3 (locality/region 裏取り必須, 実測precision約100%)",
            "seed": f"ytsearch10 x {len(queries)} (47都道府県の最大localityと人気20カテゴリの組)",
            "traversal": f"channel/videos flat-playlist, 上限{MAX_VIDEOS_PER_CHANNEL}本/ch",
        },
        "seed": {
            "queries_ok": seed_ok,
            "channels_found": len(candidates),
            "channels_per_query": len(candidates) / max(seed_ok, 1),
            "restaurants": len(seed_restaurants),
        },
        "traversal": {
            "channels_ok": n,
            "total_videos": total_videos,
            "distinct_restaurants": len(seen),
            "restaurants_per_channel": len(seen) / max(n, 1),
            "new_per_channel_first_quarter": first_q,
            "new_per_channel_last_quarter": last_q,
            "saturation_ratio": last_q / first_q if first_q else None,
        },
        "cumulative_curve": curve,
        "channels": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== チャンネル逆走査のスケール則 ===", file=sys.stderr)
    print(f"種まき : {seed_ok} クエリ -> {len(candidates)} チャンネル "
          f"({len(candidates)/max(seed_ok,1):.2f} ch/クエリ)", file=sys.stderr)
    print(f"逆走査 : {n} チャンネル / {total_videos:,} 動画 -> {len(seen):,} 店 "
          f"({len(seen)/max(n,1):.1f} 店/ch)", file=sys.stderr)
    print(f"飽和   : 初出店舗/ch は 先頭1/4 {first_q:.1f} -> 末尾1/4 {last_q:.1f} "
          f"({last_q/first_q*100 if first_q else 0:.0f}%)", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
