#!/usr/bin/env python3
"""#1279 カテゴリ全掃引時の saturation（飽和）曲線の実測（#1273 Round3）

measure_route_b_yield.py で測った u=1.83(初出1.66)/クエリ をそのまま市区町村粒度
(233,294クエリ)へ外挿すると387,268店となり、実測した供給上限 S x N = 162,660店 の
2.4倍になってしまう。つまり掃引を進めるほど「既に見つけた店」を再発見する率が上がり、
どこかで必ず頭打ちになる。本スクリプトはその頭打ちの位置と形を実測する。

方法: 特定の locality に対して134カテゴリを全部投げ、
      累積の distinct restaurant 数がどこで飽和するかを見る。
      その locality の総店舗数と比べれば「その地域での実効カバレッジ」が直接出る。

実行:
    python3 measure_sweep_saturation.py --localities 2
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

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
YT_DLP = Path("/tmp/yt-dlp-latest")

MIN_NAME_LEN = 3
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "バー", "パン屋", "弁当", "cafe", "bar", "restaurant",
}

# #1279 【設計】飽和の形は地域規模で変わるはずなので、規模帯ごとに1つずつ選ぶ。
# 決定的に選べるよう「店舗数がこの値に最も近い locality」という選び方にする。
TARGET_SIZES = [(600, "dense"), (150, "sparse")]


def normalize(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def load_population() -> tuple[dict[str, list[tuple[str, str]]], collections.Counter]:
    csv.field_size_limit(10**7)
    by_loc: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    raw_size: collections.Counter = collections.Counter()
    name_freq: collections.Counter = collections.Counter()
    with (FIXTURES / "overture_jp_food.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            loc = (r.get("locality") or "").strip()
            name = (r.get("name") or "").strip()
            if not loc or not name:
                continue
            raw_size[loc] += 1
            nn = normalize(name)
            name_freq[nn] += 1
            if len(nn) < MIN_NAME_LEN or nn in {normalize(s) for s in STOPWORD_NAMES}:
                continue
            by_loc[loc].append((nn, name))
    # #1273 §23【仕様】チェーン名は支店を確定できないため逆引き辞書から外す
    for loc, entries in by_loc.items():
        by_loc[loc] = [(nn, orig) for nn, orig in entries if name_freq[nn] < 2]
    return by_loc, raw_size


def yt_search(query: str, depth: int, timeout: int = 120) -> tuple[list[dict], str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings", f"ytsearch{depth}:{query}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return [], "timeout"
    if not proc.stdout.strip():
        return [], "empty"
    try:
        data = json.loads(proc.stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return [], "json_decode_error"
    entries = [e for e in (data.get("entries") or []) if e]
    return entries, (None if entries else "no_entries")


def reverse_match(entries: list[dict], dictionary: list[tuple[str, str]]) -> set[str]:
    found = set()
    for e in entries:
        title = normalize(e.get("title") or "")
        channel = normalize(e.get("channel") or e.get("uploader") or "")
        for nn, original in dictionary:
            if nn in title or nn in channel:
                found.add(original)
                break
    return found


def main() -> None:
    ap = argparse.ArgumentParser(description="#1279 sweep saturation measurement")
    ap.add_argument("--depth", type=int, default=20)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "sweep_saturation.json")
    args = ap.parse_args()

    by_loc, raw_size = load_population()
    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    # #1279 【設計】人気順に投げる想定なので、実運用と同じ market_salience 降順で掃引する
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))

    targets = []
    for size, label in TARGET_SIZES:
        loc = min(raw_size, key=lambda k: (abs(raw_size[k] - size), k))
        targets.append({"locality": loc, "label": label, "n_restaurants": raw_size[loc],
                        "dict_size": len(by_loc[loc])})
        raw_size.pop(loc)
    print(f"[targets] {targets}", file=sys.stderr)

    out_all = []
    for t in targets:
        loc = t["locality"]
        dictionary = by_loc[loc]

        def work(item):
            i, c = item
            q = f"{c['label_ja']} {loc}"
            entries, err = yt_search(q, args.depth)
            return {"order": i, "category_ja": c["label_ja"], "query": q,
                    "error": err, "n_results": len(entries),
                    "found": sorted(reverse_match(entries, dictionary))}

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            rows = list(pool.map(work, enumerate(cats)))
        rows.sort(key=lambda r: r["order"])

        seen: set[str] = set()
        curve = []
        for r in rows:
            new = [x for x in r["found"] if x not in seen]
            seen.update(new)
            r["n_new"] = len(new)
            curve.append(len(seen))
        ok = [r for r in rows if r["error"] is None]
        t.update({
            "queries": len(rows),
            "errors": len(rows) - len(ok),
            "distinct_found": len(seen),
            "local_coverage_pct": 100 * len(seen) / t["n_restaurants"],
            "u_first_quarter": sum(r["n_new"] for r in rows[: len(rows) // 4]) / max(1, len(rows) // 4),
            "u_last_quarter": sum(r["n_new"] for r in rows[-len(rows) // 4 :]) / max(1, len(rows) // 4),
            "cumulative_curve": curve,
            "rows": rows,
        })
        out_all.append(t)
        print(f"  {loc}({t['label']}): {t['n_restaurants']}店 -> {len(seen)}店発見 "
              f"({t['local_coverage_pct']:.1f}%)  u先頭1/4={t['u_first_quarter']:.2f} "
              f"u末尾1/4={t['u_last_quarter']:.2f}", file=sys.stderr)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "population": "Overture Places JP food_and_drink (release 2026-07-22.0)",
            "sweep": f"1localityに対し134カテゴリ全部を market_salience 降順で ytsearch{args.depth}",
            "reverse_match": "チェーン名(同名2件以上)を除いた同一locality店名辞書への部分一致",
        },
        "targets": out_all,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
