#!/usr/bin/env python3
"""#1345 1クエリの取得件数を増やすと、KPI② の「1セル5店」に届くのか

## なぜ

エリア検索は飽和しないと分かった（24エリアで重複ほぼ0）。
だが **KPI②（1エリア×1カテゴリに distinct 5店）は 144セル中4セル = 2.78%** しか
届かなかった。**1クエリ30件しか見ていない**のが効いている可能性がある。

深さ（1クエリの取得件数）を **30 → 60 → 120 → 240** と増やして、
**1セルあたりの distinct 店がどこまで伸びるか**を測る。
これは KPI② に直接効く唯一の未検証の軸である。

## 測るもの

代表セル（大都市・中核市・地方 × ラーメン/焼肉/そば の 9セル）で、
深さごとの distinct 店数と、**1件あたりの限界収量**（新しく増えた店 ÷ 増やした件数）。

## この測定が言えないこと

経路存在率である。実効は 12.7/16.29 = 78% を掛けて読むこと。
また YouTube の検索は深いページほど関連度が下がるので、
**深さを増やすと偽陽性が増える可能性がある**（増分は目視で確かめる）。

実行:
    python3 measure_shorts_depth.py
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402
from measure_shorts_route import search  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
DEPTHS = (30, 60, 120, 240)
CELLS = [("新宿", "ラーメン", "大都市"), ("新宿", "焼肉", "大都市"),
         ("新宿", "そば", "大都市"), ("岡山", "ラーメン", "中核"),
         ("岡山", "焼肉", "中核"), ("岡山", "そば", "中核"),
         ("高松", "ラーメン", "地方"), ("高松", "焼肉", "地方"),
         ("高松", "そば", "地方")]


def main() -> None:
    m = NameMatcher()
    rows = []
    agg = collections.defaultdict(lambda: [0, 0])   # depth -> [店合計, セル数]
    prev_all = {}
    for area, cat, tier in CELLS:
        q = f"{cat} {area}"
        per_depth = {}
        prev = set()
        for d in DEPTHS:
            vids = search(q, d, shorts_filter=True)
            sh = [v for v in vids if (v.get("duration") or 999) <= 60]
            st: set[str] = set()
            for v in sh:
                t = (v.get("title") or "").strip()
                if t:
                    st |= m.match_corroborated(t)
            per_depth[d] = {"n_videos": len(vids), "n_shorts": len(sh),
                            "stores": sorted(st), "new": sorted(st - prev)}
            prev = set(st)
            agg[d][0] += len(st)
            agg[d][1] += 1
        prev_all[f"{area}×{cat}"] = per_depth
        line = "  ".join(f"{d}件→{len(per_depth[d]['stores']):>2}店" for d in DEPTHS)
        print(f"  {area:4}×{cat:5}({tier})  {line}", file=sys.stderr)
        rows.append({"area": area, "cat": cat, "tier": tier,
                     "per_depth": per_depth})

    print(f"\n=== 深さごとの平均（9セル）===", file=sys.stderr)
    print(f"{'深さ':>6}{'Shorts本数':>12}{'1セルあたり店':>14}{'KPI②達成セル':>14}",
          file=sys.stderr)
    for d in DEPTHS:
        tot, n = agg[d]
        nsh = sum(r["per_depth"][d]["n_shorts"] for r in rows)
        ok = sum(1 for r in rows if len(r["per_depth"][d]["stores"]) >= 5)
        print(f"{d:>6}{nsh:>12}{tot/n:>14.2f}{ok:>10}/{n}", file=sys.stderr)

    print(f"\n=== 限界収量（深さを増やして増えた店 ÷ 増やした件数）===",
          file=sys.stderr)
    for i in range(1, len(DEPTHS)):
        d0, d1 = DEPTHS[i - 1], DEPTHS[i]
        gain = sum(len(r["per_depth"][d1]["new"]) for r in rows)
        print(f"  {d0}→{d1} 件: 新規 {gain} 店 / 増やした {(d1-d0)*len(rows)} 件 "
              f"= {gain/max((d1-d0)*len(rows),1)*1000:.2f} 店/1000件", file=sys.stderr)

    print(f"\n=== 深さで増えた店の目視標本 ===", file=sys.stderr)
    shown = 0
    for r in rows:
        for d in DEPTHS[1:]:
            for s in r["per_depth"][d]["new"][:2]:
                if shown < 15:
                    print(f"  [{r['area']}×{r['cat']} {d}件] 『{s}』",
                          file=sys.stderr)
                    shown += 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "shorts_depth.json"
    p.write_text(json.dumps(
        {"depths": DEPTHS, "rows": rows,
         "caveat": "経路存在率。実効は 78% を掛けて読むこと。"
                   "深いページほど関連度が下がるので偽陽性が増えうる（増分は目視）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
