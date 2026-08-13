#!/usr/bin/env python3
"""#1273 Round3 アイデアA: チャンネル逆走査の検証

measure_sweep_saturation.py で「1市区町村に134カテゴリを全部投げても45店しか出ない、
1クエリあたり初出は0.91→0.06まで落ちる」という飽和を実測した。ただしこれが意味するのは
**YouTubeの供給が尽きた**ことではなく、**検索ランキングが尽きた**ことかもしれない。
同じ動画でも「その動画を作ったチャンネルの過去動画を全部列挙する」経路なら、
検索順位に一切縛られずに到達できる。

本スクリプトはその仮説を検証する:
  1. 少数のカテゴリ×エリア検索で「実在店舗を名指しした動画」を出したチャンネルを種として集める
  2. そのチャンネルの過去動画を全列挙する（yt-dlp 1コールで数百件）
  3. 全動画タイトルを全国店名辞書に逆引きし、distinct店舗数を数える
  4. 検索経路（134クエリ/市区町村）とのクエリ効率を比較する

実行:
    python3 measure_channel_traversal.py --seed-queries 40 --max-channels 25
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import subprocess
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import ahocorasick  # type: ignore

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
YT_DLP = Path("/tmp/yt-dlp-latest")

# #1279 【仕様】全国辞書は誤マッチが命取りなので、短い名前とチェーン名を落とす。
# 検索経路の検証(MIN_NAME_LEN=3, locality内)より厳しくしているのは、
# 全国789k件を相手にすると3文字では偶然一致が支配的になるため。
MIN_NAME_LEN_NATIONAL = 4
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "パン屋", "弁当", "cafe", "bar", "restaurant",
    "コーヒー", "ダイニング", "キッチン", "ビストロ", "食事処", "お食事処",
}

MAX_VIDEOS_PER_CHANNEL = 400  # 巨大チャンネルで時間が爆発しないよう上限を置く


def normalize(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def build_national_automaton() -> tuple[ahocorasick.Automaton, dict[str, str], int]:
    """全国の店名から Aho-Corasick オートマトンを組む。

    同名が複数店舗ある名前（チェーン）は #1273 §23 のとおり支店を確定できないので除外する。
    戻り値: (automaton, 正規化名 -> 元の名前, 除外件数)
    """
    csv.field_size_limit(10**7)
    freq: collections.Counter = collections.Counter()
    original: dict[str, str] = {}
    rows = 0
    with (FIXTURES / "overture_jp_food.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            name = (r.get("name") or "").strip()
            if not name:
                continue
            rows += 1
            nn = normalize(name)
            freq[nn] += 1
            original.setdefault(nn, name)

    stop = {normalize(s) for s in STOPWORD_NAMES}
    automaton = ahocorasick.Automaton()
    kept = 0
    for nn, count in freq.items():
        if len(nn) < MIN_NAME_LEN_NATIONAL or count > 1 or nn in stop:
            continue
        automaton.add_word(nn, nn)
        kept += 1
    automaton.make_automaton()
    print(f"[dict] {rows:,} rows -> {kept:,} unique non-chain names "
          f"(>= {MIN_NAME_LEN_NATIONAL} chars)", file=sys.stderr)
    return automaton, original, rows - kept


def match_names(automaton: ahocorasick.Automaton, text: str) -> set[str]:
    """タイトル中に出現する店名を全部拾う。最長一致のみ採る（部分名の重複計上を避ける）。"""
    t = normalize(text)
    if not t:
        return set()
    hits = {found for _, found in automaton.iter(t)}
    # 「麺屋武蔵」と「麺屋武」の両方が辞書にあるとき、包含される短い方は落とす
    return {h for h in hits if not any(h != o and h in o for o in hits)}


def yt_json(target: str, extra: list[str], timeout: int) -> tuple[dict | None, str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings", *extra, target]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if not proc.stdout.strip():
        return None, (proc.stderr.strip().splitlines()[-1][:160] if proc.stderr.strip() else "empty")
    try:
        return json.loads(proc.stdout.splitlines()[-1]), None
    except json.JSONDecodeError:
        return None, "json_decode_error"


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Round3 idea A: channel traversal")
    ap.add_argument("--seed-queries", type=int, default=40)
    ap.add_argument("--max-channels", type=int, default=25)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "channel_traversal.json")
    args = ap.parse_args()

    automaton, original, _ = build_national_automaton()

    # --- 1. 種取り: カテゴリ×エリア検索で、店名を名指しした動画のチャンネルを集める ---
    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))
    localities = ["大阪市平野区", "さくら市", "札幌市中央区", "松山市"]
    seeds = [
        {"query": f"{cats[i % len(cats)]['label_ja']} {localities[i % len(localities)]}"}
        for i in range(args.seed_queries)
    ]

    def seed_work(s: dict) -> dict:
        data, err = yt_json(f"ytsearch10:{s['query']}", [], 120)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        found = []
        for e in entries:
            names = match_names(automaton, e.get("title") or "")
            if names and e.get("channel_id"):
                found.append({"channel_id": e["channel_id"],
                              "channel": e.get("channel") or e.get("uploader"),
                              "names": sorted(names)})
        return {**s, "error": err, "n_entries": len(entries), "found": found}

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        seed_rows = list(pool.map(seed_work, seeds))

    channels: dict[str, dict] = {}
    for row in seed_rows:
        for f in row["found"]:
            ch = channels.setdefault(f["channel_id"], {"channel": f["channel"], "seed_hits": 0})
            ch["seed_hits"] += 1
    ranked = sorted(channels.items(), key=lambda kv: -kv[1]["seed_hits"])[: args.max_channels]
    seed_queries_used = len([r for r in seed_rows if r["error"] is None])
    seed_distinct = {n for row in seed_rows for f in row["found"] for n in f["names"]}
    print(f"[seed] {seed_queries_used} queries -> {len(channels)} channels, "
          f"{len(seed_distinct)} distinct restaurants", file=sys.stderr)

    # --- 2. 各チャンネルの過去動画を全列挙して逆引き ---
    def channel_work(item: tuple[str, dict]) -> dict:
        cid, meta = item
        url = f"https://www.youtube.com/channel/{cid}/videos"
        data, err = yt_json(url, ["--playlist-end", str(MAX_VIDEOS_PER_CHANNEL)], 300)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        found: dict[str, list[str]] = {}
        for e in entries:
            for n in match_names(automaton, e.get("title") or ""):
                found.setdefault(n, []).append(e.get("id"))
        return {
            "channel_id": cid,
            "channel": meta["channel"],
            "seed_hits": meta["seed_hits"],
            "error": err,
            "n_videos": len(entries),
            "n_distinct_restaurants": len(found),
            "restaurants": {original.get(k, k): v[:3] for k, v in list(found.items())[:200]},
        }

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        ch_rows = list(pool.map(channel_work, ranked))

    ok = [c for c in ch_rows if c["error"] is None and c["n_videos"] > 0]
    all_found: set[str] = set()
    for c in ok:
        all_found.update(c["restaurants"].keys())
    total_videos = sum(c["n_videos"] for c in ok)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "hypothesis": "飽和は検索ランキングの枯渇であって供給の枯渇ではない",
            "dictionary": f"Overture全国、同名2件以上(チェーン)と{MIN_NAME_LEN_NATIONAL}文字未満を除外",
            "seed": f"ytsearch10 x {args.seed_queries}",
            "traversal": f"channel/videos flat-playlist, 上限{MAX_VIDEOS_PER_CHANNEL}本/ch",
        },
        "seed": {
            "queries": seed_queries_used,
            "channels_discovered": len(channels),
            "distinct_restaurants": len(seed_distinct),
        },
        "traversal": {
            "channels_attempted": len(ranked),
            "channels_ok": len(ok),
            "total_videos_enumerated": total_videos,
            "distinct_restaurants": len(all_found),
            "restaurants_per_channel_call": len(all_found) / len(ok) if ok else 0,
        },
        "channels": ch_rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== チャンネル逆走査 ===", file=sys.stderr)
    print(f"種取り : {seed_queries_used} クエリ -> {len(seed_distinct)} 店 "
          f"({len(seed_distinct)/max(seed_queries_used,1):.2f} 店/クエリ)", file=sys.stderr)
    print(f"逆走査 : {len(ok)} チャンネル呼び出し -> {total_videos:,} 動画列挙 "
          f"-> {len(all_found):,} 店", file=sys.stderr)
    print(f"         = {len(all_found)/max(len(ok),1):.1f} 店 / チャンネル呼び出し", file=sys.stderr)
    print(f"\n上位チャンネル:", file=sys.stderr)
    for c in sorted(ok, key=lambda x: -x["n_distinct_restaurants"])[:10]:
        print(f"  {c['n_distinct_restaurants']:4d}店 / {c['n_videos']:4d}本  {c['channel']}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
