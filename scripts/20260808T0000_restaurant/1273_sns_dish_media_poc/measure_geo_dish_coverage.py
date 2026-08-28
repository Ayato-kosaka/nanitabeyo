#!/usr/bin/env python3
"""#1273 — 新しい KPI を測る:「全国どこでも、132 の料理が 5km 以内に 5 投稿」

## オーナーが定義し直した KPI

    全国どこでも 132 件の料理が検索されたら、5km 以内に 5 投稿表示されて欲しい

**これは店単位の 70% とはまったく別の指標である。** 店を 70% 埋める必要は無く、
**ある地点の 5km 以内に、132 カテゴリそれぞれの投稿が 5 本ずつあればよい。**

## 何が効くのか

投稿の総量（推定 6,400 万本）は問題にならない。効くのは **カテゴリの地理的な偏り**である。

  5km 以内に 5 投稿 ⇔ 5km 以内に、その料理を出す店が IG 付きで最低 1 軒ある
  （1 軒あれば投稿数の中央値 564 本から 5 本は取れる。ここは投稿数が律速しない）

だから測るべきは **「ある地点の 5km 以内に、134 カテゴリそれぞれの店が IG 付きで
何軒あるか」** である。青森の山中にイタリアンが無ければ、パスタの投稿は 0 本になる。

## 方法

  1. 3 ソースの fixture（overture / osm / ifas、計 124 万行）を読む
  2. 店名に `CategoryMatcher` を当てて dish_category を付ける（実測ヒット率 24.1%）
  3. 利用者の位置を、**店の位置から無作為抽出**して代理とする
     （人がいる所に店がある。決定的シード付きで再現できる）
  4. 各地点の 5km 以内の店を数え、カテゴリごとに何軒あるかを出す
  5. IG が取れる店を、**実測値から決定的に**マークする
       リンク層（サイト or SNS を持つ）は seed の 69.7%
       IG 到達は母集団の 16.17% = リンク層の 23.2%
       #1269 の誤紐付けの門を通るのが 64.4% → リンク層の 14.9%

## この測定が言えないこと

  - **店名からのカテゴリ付与は 24.1% にしか当たらない。** 付かない 76% の店も
    実際には何かの料理を出しているので、**これは下限である**
  - 「その店が IG にその料理の写真を上げているか」は**別問題で未測定**
  - 利用者の位置を店の位置で代理している。実際の人口分布とはずれる

実行:
    python3 measure_geo_dish_coverage.py --samples 2000
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import random
import sys
from pathlib import Path

from dish_category_matcher import CategoryMatcher

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures"
OUT = HERE / "out"
SOURCES = ["overture_jp_food.csv", "osm_jp_food.csv", "ifas_jp_food.csv"]
RADIUS_KM = 5.0
NEED_POSTS = 5
CELL_DEG = 0.05                                  # 緯度 0.05° ≒ 5.55km

# 実測値から決めた、IG が取れて門を通る店の割合（リンク層のなかで）
LINK_LAYER_SHARE = 789_235 / 1_132_482           # 0.697
IG_REACH_OF_POP = 0.1617                         # 実測（サイト巡回）
GATE_PASS = 0.644                                # 実測（#1269 の門・101 対）
IG_OK_IN_LINK_LAYER = IG_REACH_OF_POP * GATE_PASS / LINK_LAYER_SHARE


def hav(a1, o1, a2, o2) -> float:
    r = 6371.0
    p1, p2 = math.radians(a1), math.radians(a2)
    dp, dl = p2 - p1, math.radians(o2 - o1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def det_flag(key: str, p: float) -> bool:
    """決定的な擬似乱数。同じ入力なら何度走らせても同じ答えになる"""
    h = hashlib.sha256(key.encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64 < p


def load() -> list[tuple]:
    csv.field_size_limit(10**7)
    m = CategoryMatcher()
    rows = []
    for fn in SOURCES:
        p = FIX / fn
        if not p.exists():
            raise SystemExit(f"fixture が無い: {p}")
        src = fn.split("_")[0]
        with p.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                try:
                    la, lo = float(r["latitude"]), float(r["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                if not name or not (24 <= la <= 46 and 122 <= lo <= 146):
                    continue
                link = (int(r.get("n_socials") or 0) > 0
                        or int(r.get("n_websites") or 0) > 0)
                cats = tuple(sorted({c["dish_category_id"] for c in m.match(name)}))
                rid = r.get("id") or f"{src}:{name}:{la}"
                ig = link and det_flag(rid, IG_OK_IN_LINK_LAYER)
                rows.append((la, lo, cats, ig))
        print(f"  {fn}: 累計 {len(rows):,}", file=sys.stderr, flush=True)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=2000)
    a = ap.parse_args()

    cats_all = {}
    with (FIX / "public_dish_categories_134_gate.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            cats_all[r["dish_category_id"]] = (r["label_ja"], float(r["market_salience_jp"]))
    print(f"料理カテゴリ {len(cats_all)} 件", file=sys.stderr)

    rows = load()
    n_ig = sum(1 for r in rows if r[3])
    print(f"行 {len(rows):,} / IG が取れて門を通る {n_ig:,} "
          f"({n_ig/len(rows)*100:.2f}%)", file=sys.stderr)

    grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    for i, (la, lo, _, _) in enumerate(rows):
        grid[(int(la / CELL_DEG), int(lo / CELL_DEG))].append(i)

    rng = random.Random(20260828)
    idx = rng.sample(range(len(rows)), min(a.samples, len(rows)))

    near_all, near_ig, ncat_all, ncat_ig = [], [], [], []
    cat_hits: collections.Counter[str] = collections.Counter()
    full = 0
    for si in idx:
        la, lo, _, _ = rows[si]
        gy, gx = int(la / CELL_DEG), int(lo / CELL_DEG)
        span = int(RADIUS_KM / 111.0 / CELL_DEG) + 1
        seen_all = seen_ig = 0
        cs_all: set[str] = set()
        cs_ig: set[str] = set()
        for dy in range(-span, span + 1):
            for dx in range(-span, span + 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    la2, lo2, cats, ig = rows[j]
                    if hav(la, lo, la2, lo2) > RADIUS_KM:
                        continue
                    seen_all += 1
                    cs_all.update(cats)
                    if ig:
                        seen_ig += 1
                        cs_ig.update(cats)
        near_all.append(seen_all); near_ig.append(seen_ig)
        ncat_all.append(len(cs_all)); ncat_ig.append(len(cs_ig))
        for c in cs_ig:
            cat_hits[c] += 1
        if len(cs_ig) >= 132:
            full += 1

    def q(v, p):
        s = sorted(v)
        return s[min(len(s) - 1, int(len(s) * p))]

    n = len(idx)
    per_cat = sorted(
        ((cid, cats_all.get(cid, ("?", 0))[0], cats_all.get(cid, ("?", 0))[1],
          cat_hits.get(cid, 0), round(cat_hits.get(cid, 0) / n * 100, 1))
         for cid in cats_all),
        key=lambda x: -x[3])

    res = {
        "purpose": "オーナーが定義し直した KPI「全国どこでも 132 料理が 5km 以内に 5 投稿」を測る",
        "radius_km": RADIUS_KM, "n_sampled_locations": n,
        "n_rows": len(rows), "n_ig_gated": n_ig,
        "ig_rate_used": round(IG_OK_IN_LINK_LAYER, 4),
        "restaurants_within_5km": {
            "median": q(near_all, .5), "p10": q(near_all, .1), "p90": q(near_all, .9)},
        "ig_restaurants_within_5km": {
            "median": q(near_ig, .5), "p10": q(near_ig, .1), "p90": q(near_ig, .9)},
        "dish_categories_within_5km_any_store": {
            "median": q(ncat_all, .5), "p10": q(ncat_all, .1), "p90": q(ncat_all, .9)},
        "dish_categories_within_5km_ig_store": {
            "median": q(ncat_ig, .5), "p10": q(ncat_ig, .1), "p90": q(ncat_ig, .9)},
        "locations_meeting_132_categories": full,
        "locations_meeting_132_pct": round(full / n * 100, 2),
        "per_category_location_coverage_pct": [
            {"id": c, "label_ja": l, "salience": s, "locations": k, "pct": p}
            for c, l, s, k, p in per_cat],
        "caveat": ("店名からのカテゴリ付与は実測 24.1% にしか当たらないので、これは下限である。"
                   "その店が実際にその料理の写真を IG に上げているかは未測定。"
                   "利用者の位置を店の位置で代理している"),
    }
    (OUT / "geo_dish_coverage.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))

    print(f"\n=== 5km 以内（無作為 {n} 地点、店の位置を利用者の位置の代理とする）===")
    print(f"  飲食店            中央値 {q(near_all,.5):>6,}   下位10% {q(near_all,.1):>5,}   上位10% {q(near_all,.9):>7,}")
    print(f"  うち IG が取れる  中央値 {q(near_ig,.5):>6,}   下位10% {q(near_ig,.1):>5,}   上位10% {q(near_ig,.9):>7,}")
    print(f"  料理カテゴリ(全店) 中央値 {q(ncat_all,.5):>5}/134  下位10% {q(ncat_all,.1):>4}  上位10% {q(ncat_all,.9):>5}")
    print(f"  料理カテゴリ(IG店) 中央値 {q(ncat_ig,.5):>5}/134  下位10% {q(ncat_ig,.1):>4}  上位10% {q(ncat_ig,.9):>5}")
    print(f"\n  132 カテゴリを満たした地点: {full}/{n} = {full/n*100:.2f}%")
    print("\n--- 地点カバー率の上位10カテゴリ ---")
    for c, l, s, k, p in per_cat[:10]:
        print(f"    {p:5.1f}%  {l}")
    print("--- 下位10カテゴリ ---")
    for c, l, s, k, p in per_cat[-10:]:
        print(f"    {p:5.1f}%  {l}")
    print("\n→ out/geo_dish_coverage.json")


if __name__ == "__main__":
    main()
