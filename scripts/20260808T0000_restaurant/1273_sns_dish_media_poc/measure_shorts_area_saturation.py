#!/usr/bin/env python3
"""#1345 Shorts のカテゴリ×エリア検索は、エリアを増やすと伸びるのか（飽和を測る）

## なぜ

Shorts は実効 12.7店/ch と、これまでで最も素材の質が良い経路だと分かった。
残る問いは**規模**である。今まで測ったのは **6エリア × 6カテゴリ = 36クエリ**しかない。

KPI②（1エリア×1カテゴリに distinct 5店）を全国で満たすには、
**エリアを増やしたときに distinct 店がどう伸びるか**が要る。
伸びが線形なら全国展開で効き、すぐ飽和するなら都市部限定の手段にしかならない。

チャンネル巡回では既に飽和が見えている（ch 5→56 で店は 3.5倍にしかならず、
k は 1.22→1.27 で動かなかった）。**検索経路でも同じことが起きるのかを確かめる。**

## 測るもの

エリアを **6 → 24** に増やし（政令市・県庁所在地・地方中核市を混ぜる）、
同じ6カテゴリで検索して、

  1. エリア数に対する **distinct 店の伸び**（飽和曲線）
  2. **1エリアあたりの新規店**（既出を除いた純増）
  3. エリアの規模帯（大都市／中核市／地方）ごとの収量差
  4. **KPI② の判定**: 各 (エリア, カテゴリ) セルで distinct 5店に届くか

## この測定が言えないこと

  - 検索結果は YouTube の順位に依存する。1クエリ 30件しか見ていない
  - **経路存在率**である。実効は 12.7/16.29 = 78% を掛けて読むこと
  - 「エリア」は検索語であって行政区画のセルではない。KPI② のセルとは厳密には違う

実行:
    python3 measure_shorts_area_saturation.py --per-query 30
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402
from measure_shorts_route import search  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

CATEGORIES = ["ラーメン", "焼肉", "寿司", "カレー", "そば", "定食"]
# 規模帯を混ぜる（決め方: 政令市／県庁所在地／地方中核市を8つずつ）
AREAS = [
    # 大都市（政令市・特別区）
    ("新宿", "大都市"), ("渋谷", "大都市"), ("大阪", "大都市"), ("名古屋", "大都市"),
    ("横浜", "大都市"), ("福岡", "大都市"), ("札幌", "大都市"), ("神戸", "大都市"),
    # 県庁所在地クラス
    ("仙台", "中核"), ("広島", "中核"), ("京都", "中核"), ("金沢", "中核"),
    ("熊本", "中核"), ("岡山", "中核"), ("新潟", "中核"), ("鹿児島", "中核"),
    # 地方
    ("高松", "地方"), ("松山", "地方"), ("盛岡", "地方"), ("秋田", "地方"),
    ("宮崎", "地方"), ("福井", "地方"), ("鳥取", "地方"), ("佐賀", "地方"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-query", type=int, default=30)
    args = ap.parse_args()

    m = NameMatcher()
    cm = CategoryMatcher()
    seen: set[str] = set()
    curve = []
    per_area: dict[str, dict] = {}
    cells: dict[tuple, set] = collections.defaultdict(set)
    rows = []

    for ai, (area, tier) in enumerate(AREAS, 1):
        new_here: set[str] = set()
        got_here: set[str] = set()
        n_sh = n_vid = 0
        for cat in CATEGORIES:
            q = f"{cat} {area}"
            vids = search(q, args.per_query, shorts_filter=True)
            n_vid += len(vids)
            for v in vids:
                t = (v.get("title") or "").strip()
                if not t:
                    continue
                dur = v.get("duration")
                is_short = dur is not None and dur <= 60
                n_sh += is_short
                if not is_short:
                    continue          # Shorts だけを数える
                st = m.match_corroborated(t)
                if not st:
                    continue
                got_here |= st
                cells[(area, cat)] |= st
                rows.append({"area": area, "tier": tier, "cat": cat,
                             "title": t[:80], "stores": sorted(st),
                             "cats": sorted({x["dish_category_id"]
                                             for x in cm.match(t)})})
        new_here = got_here - seen
        seen |= got_here
        per_area[area] = {"tier": tier, "n_videos": n_vid, "n_shorts": n_sh,
                          "stores": len(got_here), "new": len(new_here)}
        curve.append((ai, len(seen)))
        print(f"  {ai:>2}. {area:6}({tier})  Shorts {n_sh:>4}  "
              f"店 {len(got_here):>3}  **新規 {len(new_here):>3}**  "
              f"累計 {len(seen):>4}", file=sys.stderr)

    print(f"\n=== 飽和曲線（エリア数 → 累計 distinct 店）===", file=sys.stderr)
    for a, s in curve:
        if a % 4 == 0 or a == 1:
            print(f"  {a:>2} エリア → {s:>4} 店 （1エリアあたり {s/a:.1f}）",
                  file=sys.stderr)

    # 前半12エリア / 後半12エリアの純増を比べる（飽和の指標）
    half = len(AREAS) // 2
    first = curve[half - 1][1]
    total = curve[-1][1]
    print(f"\n  前半{half}エリアで {first} 店 / 後半{half}エリアの純増 "
          f"{total-first} 店 = **{(total-first)/max(first,1)*100:.1f}%**",
          file=sys.stderr)

    print(f"\n=== 規模帯ごと ===", file=sys.stderr)
    tier_agg = collections.defaultdict(lambda: [0, 0, 0])
    for a, d in per_area.items():
        t = d["tier"]
        tier_agg[t][0] += 1
        tier_agg[t][1] += d["stores"]
        tier_agg[t][2] += d["new"]
    for t in ("大都市", "中核", "地方"):
        n, s, nw = tier_agg[t]
        if n:
            print(f"  {t:6} エリア {n:>2}  店 計 {s:>4}（1エリア {s/n:5.1f}）"
                  f"  純増 計 {nw:>4}", file=sys.stderr)

    # --- KPI② の判定 --------------------------------------------------------
    ok5 = sum(1 for v in cells.values() if len(v) >= 5)
    print(f"\n=== KPI②（1エリア×1カテゴリに distinct 5店）===", file=sys.stderr)
    print(f"  セル {len(AREAS)*len(CATEGORIES)} のうち、5店に届いたのは "
          f"**{ok5} = {ok5/(len(AREAS)*len(CATEGORIES))*100:.2f}%**", file=sys.stderr)
    dist = collections.Counter(len(v) for v in cells.values())
    empty = len(AREAS) * len(CATEGORIES) - len(cells)
    print(f"  0店のセル {empty}", file=sys.stderr)
    for k in sorted(dist)[:8]:
        print(f"  {k}店のセル {dist[k]}", file=sys.stderr)
    best = sorted(cells.items(), key=lambda kv: -len(kv[1]))[:8]
    print(f"  上位セル: " + " / ".join(f"{a}×{c}={len(v)}" for (a, c), v in best),
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "shorts_area_saturation.json"
    p.write_text(json.dumps(
        {"n_areas": len(AREAS), "n_categories": len(CATEGORIES),
         "curve": curve, "per_area": per_area,
         "cells": {f"{a}×{c}": sorted(v) for (a, c), v in cells.items()},
         "n_cells_ge5": ok5, "distinct_total": len(seen), "rows": rows[:2000],
         "caveat": "経路存在率。実効は 12.7/16.29 = 78% を掛けて読むこと。"
                   "1クエリ30件しか見ておらず、YouTube の検索順位に依存する。"
                   "「エリア」は検索語であって KPI② の行政区画セルとは厳密には違う。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
