#!/usr/bin/env python3
"""#1279 Route B の実効歩留まり u の実測（#1273 Round3）

u = 「1クエリ(カテゴリ×エリア)あたり、初出かつ店舗を特定できた restaurant 数」。
coverage_route_b.py のクエリ予算フロンティアが要求する u を実際に満たせるかを測る。

Route A（店名で引いて、その店の動画があるか）とは向きが逆であることに注意。
Route B では「探していた店」でなくても、動画が **どこかの実在店舗** を名指ししていて
それが母集団に照合できれば成功。この非対称性が #1279 の核心で、
REPORT.md v3 の p=0.20 は Route A の向きで測った数字なので Route B には使えない。

母集団は Overture Places JP food_and_drink (789,612件)。逆引きは同一 locality 内の
店名インデックスに対して行う（全国 789k 件への総当たりは誤マッチが激増するため）。

実行:
    python3 measure_route_b_yield.py --n-queries 200 --depth 20
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
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
OVERTURE_CSV = FIXTURES / "overture_jp_food.csv"
CATEGORIES_CSV = FIXTURES / "public_dish_categories_134_gate.csv"
YT_DLP = Path("/tmp/yt-dlp-latest")

DEFAULT_N_QUERIES = 200
DEFAULT_DEPTH = 20
DEFAULT_CONCURRENCY = 4

MIN_LOCALITY_SIZE = 100  # 逆引き辞書として意味を持つ最小の店舗数
MIN_NAME_LEN = 3  # #1279 【仕様】3文字未満の店名は部分一致の誤マッチ源なので逆引き対象外

# #1279 【仕様】店名として一般的すぎて動画タイトルに偶然出現する語は逆引き辞書から外す。
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "バー", "パン屋", "弁当", "cafe", "bar", "restaurant",
}


def normalize(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def load_population() -> tuple[dict[str, list[tuple[str, str]]], dict]:
    """locality -> [(正規化店名, 元店名)] の逆引き辞書を作る。

    戻り値の第2要素は locality ごとの店舗数（サンプリングの重みに使う）。
    """
    if not OVERTURE_CSV.exists():
        raise SystemExit(f"fixture not found: {OVERTURE_CSV}")
    csv.field_size_limit(10**7)
    by_loc: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    with OVERTURE_CSV.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            loc = (r.get("locality") or "").strip()
            name = (r.get("name") or "").strip()
            if not loc or not name:
                continue
            nn = normalize(name)
            # 短すぎる名前・一般語は誤マッチ源なので逆引き辞書に入れない（=uの下限側推定になる）
            if len(nn) < MIN_NAME_LEN or nn in {normalize(s) for s in STOPWORD_NAMES}:
                continue
            by_loc[loc].append((nn, name))
    sizes = {k: len(v) for k, v in by_loc.items()}
    return by_loc, sizes


def load_categories() -> list[dict]:
    with CATEGORIES_CSV.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def build_query_sample(sizes: dict, cats: list[dict], n_queries: int) -> list[dict]:
    """(locality, category) のクエリ標本を決定的に作る。

    エリアは店舗数 >= MIN_LOCALITY_SIZE の locality から店舗数上位/中位/下位を均等に、
    カテゴリは market_salience の High/Middle/Long-tail を均等に取り、
    #1273 §15 の「18カテゴリ×6エリアタイプ」の設計思想を縮約して踏襲する。
    """
    locs = sorted([(k, v) for k, v in sizes.items() if v >= MIN_LOCALITY_SIZE], key=lambda x: -x[1])
    n = len(locs)
    tiers = {"dense": locs[: n // 3], "mid": locs[n // 3 : 2 * n // 3], "sparse": locs[2 * n // 3 :]}

    cats_sorted = sorted(cats, key=lambda c: -float(c.get("market_salience_jp") or 0))
    m = len(cats_sorted)
    ctiers = {
        "high": cats_sorted[: m // 3],
        "middle": cats_sorted[m // 3 : 2 * m // 3],
        "longtail": cats_sorted[2 * m // 3 :],
    }

    combos = []
    per_cell = max(1, n_queries // 9)
    for ltier, lrows in tiers.items():
        for ctier, crows in ctiers.items():
            lrows_s = sorted(lrows, key=lambda x: hashlib.sha256(x[0].encode()).hexdigest())
            crows_s = sorted(crows, key=lambda c: hashlib.sha256(c["dish_category_id"].encode()).hexdigest())
            for i in range(per_cell):
                loc, size = lrows_s[i % len(lrows_s)]
                cat = crows_s[i % len(crows_s)]
                combos.append(
                    {
                        "locality": loc,
                        "locality_size": size,
                        "locality_tier": ltier,
                        "category_id": cat["dish_category_id"],
                        "category_ja": cat["label_ja"],
                        "category_tier": ctier,
                        "salience": float(cat.get("market_salience_jp") or 0),
                    }
                )
    return combos


def yt_search(query: str, depth: int, timeout: int = 120) -> tuple[list[dict], str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings", f"ytsearch{depth}:{query}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return [], "timeout"
    if not proc.stdout.strip():
        return [], (proc.stderr.strip().splitlines()[-1][:200] if proc.stderr.strip() else "empty")
    try:
        data = json.loads(proc.stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return [], "json_decode_error"
    entries = [e for e in (data.get("entries") or []) if e]
    return entries, (None if entries else "no_entries")


def reverse_match(entries: list[dict], dictionary: list[tuple[str, str]]) -> list[dict]:
    """動画タイトル/チャンネル名に、その locality の実在店名が出現するかを総当たりで見る。

    Route Bの成功条件は「探していた店かどうか」ではなく「実在店舗を1つ特定できたか」。
    副作用なし。失敗時は空リストを返す。
    """
    matches = []
    for e in entries:
        title = normalize(e.get("title") or "")
        channel = normalize(e.get("channel") or e.get("uploader") or "")
        if not title and not channel:
            continue
        for nn, original in dictionary:
            if nn in title:
                matches.append({"video_id": e.get("id"), "restaurant": original,
                                "evidence": "name_in_title", "title": e.get("title")})
                break
            if nn in channel:
                matches.append({"video_id": e.get("id"), "restaurant": original,
                                "evidence": "name_in_channel", "title": e.get("title")})
                break
    return matches


def main() -> None:
    ap = argparse.ArgumentParser(description="#1279 Route B yield (u) measurement")
    ap.add_argument("--n-queries", type=int, default=DEFAULT_N_QUERIES)
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    ap.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "route_b_yield.json")
    args = ap.parse_args()

    if not YT_DLP.exists():
        raise SystemExit(f"yt-dlp not found at {YT_DLP}")

    by_loc, sizes = load_population()
    cats = load_categories()
    combos = build_query_sample(sizes, cats, args.n_queries)
    print(f"[sample] {len(combos)} queries over {len(sizes):,} localities", file=sys.stderr)

    seen_global: set[str] = set()
    results = []

    def work(item: tuple[int, dict]) -> dict:
        i, c = item
        query = f"{c['category_ja']} {c['locality']}"
        entries, err = yt_search(query, args.depth)
        matches = reverse_match(entries, by_loc[c["locality"]])
        distinct = sorted({m["restaurant"] for m in matches})
        if (i + 1) % 25 == 0:
            print(f"  ...{i+1}/{len(combos)}", file=sys.stderr)
        return {**c, "query": query, "error": err, "n_results": len(entries),
                "n_matches": len(matches), "distinct_restaurants": distinct,
                "n_distinct": len(distinct), "matches": matches[:5]}

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(work, enumerate(combos)))

    # 初出判定はクエリ順に依存するため、実行後に決定的な順序で数え直す
    results.sort(key=lambda r: (r["locality_tier"], r["category_tier"], r["locality"], r["category_ja"]))
    n_new_total = 0
    for r in results:
        new = [x for x in r["distinct_restaurants"] if x not in seen_global]
        seen_global.update(new)
        r["n_new"] = len(new)
        n_new_total += len(new)

    ok = [r for r in results if r["error"] is None]
    u_distinct = sum(r["n_distinct"] for r in ok) / len(ok) if ok else 0
    u_new = n_new_total / len(ok) if ok else 0

    def agg(key: str) -> dict:
        out = {}
        for r in ok:
            out.setdefault(r[key], []).append(r)
        return {
            k: {
                "n_queries": len(v),
                "u_distinct": sum(x["n_distinct"] for x in v) / len(v),
                "u_new": sum(x["n_new"] for x in v) / len(v),
                "zero_match_rate": sum(1 for x in v if x["n_distinct"] == 0) / len(v),
            }
            for k, v in out.items()
        }

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "population": "Overture Places JP food_and_drink (release 2026-07-22.0)",
            "search": f"yt-dlp ytsearch{args.depth}, query='{{category_ja}} {{locality}}'",
            "reverse_match": "同一localityの店名辞書に対する、タイトル/チャンネル名の部分一致",
            "bias": "3文字未満・一般語の店名を辞書から除外しているため u の下限側推定",
        },
        "n_queries": len(combos),
        "n_evaluated": len(ok),
        "n_errors": len(results) - len(ok),
        "depth": args.depth,
        "u_distinct_per_query": u_distinct,
        "u_new_per_query": u_new,
        "slot_efficiency_pct": 100 * u_distinct / args.depth,
        "distinct_restaurants_total": len(seen_global),
        "by_locality_tier": agg("locality_tier"),
        "by_category_tier": agg("category_tier"),
        "results": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== Route B yield ===", file=sys.stderr)
    print(f"evaluated {len(ok)}/{len(combos)}  depth={args.depth}", file=sys.stderr)
    print(f"u (distinct/query)     = {u_distinct:.2f}  (slot efficiency {100*u_distinct/args.depth:.1f}%)", file=sys.stderr)
    print(f"u (NEW distinct/query) = {u_new:.2f}", file=sys.stderr)
    print(f"distinct restaurants discovered = {len(seen_global):,}", file=sys.stderr)
    for k, v in out["by_locality_tier"].items():
        print(f"  locality[{k:6s}] u={v['u_distinct']:.2f} new={v['u_new']:.2f} zero={v['zero_match_rate']:.0%}", file=sys.stderr)
    for k, v in out["by_category_tier"].items():
        print(f"  category[{k:8s}] u={v['u_distinct']:.2f} new={v['u_new']:.2f} zero={v['zero_match_rate']:.0%}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
