#!/usr/bin/env python3
"""#1273 Round3: スノーボール・クロールの本走（スケール則の検証と dish_media 生成）

measure_channel_crawl.py / measure_channel_snowball.py で各段の効率は測れたが、
スケール則 `distinct = 58.6 * ch^0.803` は **52チャンネルの実測から1万チャンネルへの
2桁外挿**であり、ここが崩れると全国推計が全部崩れる。本スクリプトはクロールを
実際に数百チャンネル規模まで回して、指数が保つかを実測点で確かめる。

ループ:
    未探索の発見済み店舗を選ぶ
      -> スノーボール検索（その店を撮った別チャンネルを拾う）
      -> 新規チャンネルを逆走査（過去動画を全列挙）
      -> 新しい店舗と dish_media が増える
    を、チャンネル予算を使い切るまで繰り返す

途中経過は逐次キャッシュに書くので、中断しても再開できる。

実行:
    python3 run_snowball_crawl.py --channel-budget 400
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from measure_channel_traversal import MAX_VIDEOS_PER_CHANNEL, NameMatcher, yt_json
from measure_dish_media_yield import load_categories, match_categories

HERE = Path(__file__).resolve().parent


def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"channels": {}, "probed_restaurants": [], "seed_bootstrapped": False}


def bootstrap_from_caches(state: dict) -> None:
    """先行実験のキャッシュを初期状態として取り込む（同じチャンネルを二度叩かない）。"""
    for rel in ("out/channel_crawl_cache.json", "out/channel_titles_cache.json"):
        p = HERE / rel
        if not p.exists():
            continue
        cache = json.loads(p.read_text(encoding="utf-8"))
        for c in cache.get("channels", []):
            cid = c.get("channel_id")
            if cid and cid not in state["channels"]:
                state["channels"][cid] = {"channel": c.get("channel"), "videos": c.get("videos", [])}
    state["seed_bootstrapped"] = True


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 snowball crawl (scale-law validation)")
    ap.add_argument("--channel-budget", type=int, default=400, help="逆走査するチャンネル数の上限")
    ap.add_argument("--probes-per-round", type=int, default=30)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--state", type=Path, default=HERE / "out" / "snowball_crawl_state.json")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "snowball_crawl.json")
    args = ap.parse_args()

    matcher = NameMatcher()
    cats = load_categories()
    state = load_state(args.state)
    if not state.get("seed_bootstrapped"):
        bootstrap_from_caches(state)
    print(f"[state] 初期チャンネル {len(state['channels'])}", file=sys.stderr)

    def restaurants_of(videos: list[dict]) -> set[str]:
        out: set[str] = set()
        for v in videos:
            out |= matcher.match_corroborated(v.get("title") or "")
        return out

    # 現在までに発見済みの店舗
    discovered: set[str] = set()
    for c in state["channels"].values():
        discovered |= restaurants_of(c.get("videos", []))
    probed = set(state.get("probed_restaurants", []))
    print(f"[state] 発見済み店舗 {len(discovered)} / プローブ済み {len(probed)}", file=sys.stderr)

    def snowball(rkey: str) -> list[dict]:
        loc, _ = matcher.area.get(rkey, ("", ""))
        name = matcher.original.get(rkey, rkey)
        data, err = yt_json(f"ytsearch10:{name} {loc}".strip(), [], 120)
        if err:
            return []
        return [e for e in ((data or {}).get("entries") or []) if e]

    def traverse(item: tuple[str, str]) -> dict:
        cid, cname = item
        data, err = yt_json(f"https://www.youtube.com/channel/{cid}/videos",
                            ["--playlist-end", str(MAX_VIDEOS_PER_CHANNEL)], 300)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {"channel_id": cid, "channel": cname, "error": err,
                "videos": [{"id": e.get("id"), "title": e.get("title")} for e in entries]}

    curve: list[dict] = []
    rounds = 0
    while len(state["channels"]) < args.channel_budget:
        rounds += 1
        pool_r = sorted(discovered - probed, key=lambda k: hashlib.sha256(k.encode()).hexdigest())
        if not pool_r:
            print("[stop] プローブできる未探索店舗が尽きた", file=sys.stderr)
            break
        batch = pool_r[: args.probes_per_round]
        probed.update(batch)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            entry_lists = list(pool.map(snowball, batch))

        new_channels: dict[str, str] = {}
        for entries in entry_lists:
            for e in entries:
                cid = e.get("channel_id")
                if not cid or cid in state["channels"] or cid in new_channels:
                    continue
                # 店舗を名指しした動画を出したチャンネルだけを候補にする
                if matcher.match_corroborated(e.get("title") or ""):
                    new_channels[cid] = e.get("channel") or e.get("uploader") or ""

        room = args.channel_budget - len(state["channels"])
        targets = list(new_channels.items())[:room]
        if not targets:
            print(f"[round {rounds}] 新規チャンネルなし（プローブ {len(batch)}）", file=sys.stderr)
            continue

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            fetched = list(pool.map(traverse, targets))

        for c in fetched:
            if c["error"] or not c["videos"]:
                continue
            state["channels"][c["channel_id"]] = {"channel": c["channel"], "videos": c["videos"]}
            discovered |= restaurants_of(c["videos"])

        state["probed_restaurants"] = sorted(probed)
        args.state.parent.mkdir(parents=True, exist_ok=True)
        args.state.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

        curve.append({"round": rounds, "channels": len(state["channels"]),
                      "restaurants": len(discovered)})
        print(f"[round {rounds}] ch={len(state['channels']):4d} 店={len(discovered):6d} "
              f"(+{len(targets)}ch)", file=sys.stderr)

    # --- 集計: スケール則の再フィットと dish_media 生成 ---
    all_videos: dict[str, dict] = {}
    for cid, c in state["channels"].items():
        for v in c["videos"]:
            if v.get("id") and v.get("title"):
                all_videos[v["id"]] = {**v, "channel": c["channel"], "channel_id": cid}

    triples: set[tuple[str, str]] = set()
    cat_counter: collections.Counter = collections.Counter()
    n_rest_videos = 0
    for v in all_videos.values():
        rests = matcher.match_corroborated(v["title"])
        if not rests:
            continue
        n_rest_videos += 1
        for c in match_categories(cats, v["title"]):
            for rkey in rests:
                triples.add((rkey, c["dish_category_id"]))
                cat_counter[c["label_ja"]] += 1

    # チャンネル順の累積曲線（決定的順序）で Heaps 則を引き直す
    order = sorted(state["channels"].items(), key=lambda kv: kv[0])
    seen: set[str] = set()
    cum = []
    for cid, c in order:
        seen |= restaurants_of(c["videos"])
        cum.append(len(seen))
    fit = None
    if len(cum) > 10:
        xs = [math.log(i + 1) for i in range(len(cum))]
        ys = [math.log(v) for v in cum if v > 0]
        xs = xs[: len(ys)]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
        fit = {"a": math.exp(my - b * mx), "b": b}

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": matcher.sources_used,
        "channels": len(state["channels"]),
        "videos": len(all_videos),
        "restaurant_matched_videos": n_rest_videos,
        "distinct_restaurants": len(seen),
        "dish_media_pairs": len(triples),
        "categories_used": len(cat_counter),
        "top_categories": cat_counter.most_common(15),
        "restaurants_per_channel": len(seen) / max(len(state["channels"]), 1),
        "heaps_fit": fit,
        "round_curve": curve,
        "cumulative_curve": cum,
    }
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== スノーボール・クロール結果 ===", file=sys.stderr)
    print(f"チャンネル {len(state['channels']):,} / 動画 {len(all_videos):,}", file=sys.stderr)
    print(f"distinct 店舗 {len(seen):,} ({len(seen)/max(len(state['channels']),1):.1f} 店/ch)", file=sys.stderr)
    print(f"dish_media (店×カテゴリ) {len(triples):,} / 使用カテゴリ {len(cat_counter)}/134", file=sys.stderr)
    if fit:
        print(f"Heaps則: distinct = {fit['a']:.1f} * ch^{fit['b']:.3f}", file=sys.stderr)
        for k in (1000, 10000):
            print(f"  外挿 {k:,}ch -> {fit['a']*k**fit['b']:,.0f} 店", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
