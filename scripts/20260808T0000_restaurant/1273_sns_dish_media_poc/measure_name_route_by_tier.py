#!/usr/bin/env python3
"""#1273 店名経路は rural でも効くのか（地理の制約を回避できる唯一の経路か）

## なぜ

#1319 R8-B で「地方の 0% は発見の問題ではなく**半径1kmに 5.66軒しかない**という
地理の問題」と実測した。密度は urban 197.54 / suburban 27.45 / rural 5.66 で 35倍差があり、
発見率で 3.1倍稼いでも消せない。

**店名経路だけは外部リソースへの到達を必要としない**（屋号を読むだけ）。
リンクの有無に依存しないことは実測済み（リンク有り 25.46% / リンク無し 21.61%）。
**密度にも依存しないなら**、rural で唯一使える経路になる。

## tier の決め方（自分で決めたので明記する）

fixtures に tier 列は無い。座標から **半径1km以内の母集団店舗数** を数えて割る。
閾値は R8-B の密度センサス（urban 197.54 / suburban 27.45 / rural 5.66）の
**隣り合う平均の幾何平均**を境にした:

    urban    : n >= 74   （sqrt(197.54 * 27.45) = 73.6）
    suburban : 13 <= n < 74   （sqrt(27.45 * 5.66) = 12.5）
    rural    : n < 13

割った後の実測平均密度を出力するので、センサスと突き合わせて妥当性を確認できる。

## 標本

近傍数の厳密計算は 1,244,029 行全部だと重いので、**SHA-256 順で決定的に 200,000 行**を抜く。
層別の率を出すには十分で、選び方は再現可能である。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_name_route_by_tier.py
    python3 measure_name_route_by_tier.py --sample 20000   # 動作確認
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_locality_backfill import cell_of, haversine_km, load_rows  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

RADIUS_KM = 1.0
# R8-B の密度センサス（半径1km内の母集団店舗数の平均）
CENSUS = {"urban": 197.54, "suburban": 27.45, "rural": 5.66}
URBAN_MIN = 74      # sqrt(197.54 * 27.45) = 73.6
SUBURBAN_MIN = 13   # sqrt(27.45 * 5.66)  = 12.5


def tier_of(n_within_1km: int) -> str:
    if n_within_1km >= URBAN_MIN:
        return "urban"
    if n_within_1km >= SUBURBAN_MIN:
        return "suburban"
    return "rural"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 店名経路の tier 別内訳")
    ap.add_argument("--sample", type=int, default=200000)
    args = ap.parse_args()

    rows = list(load_rows())
    print(f"読み込み {len(rows):,} 行", file=sys.stderr)

    # 密度は**母集団全体**で数える（標本内だけで数えると密度が過小になる）
    grid: dict[tuple[int, int], list[tuple[float, float]]] = collections.defaultdict(list)
    for r in rows:
        grid[cell_of(r["lat"], r["lon"])].append((r["lat"], r["lon"]))
    print(f"格子セル {len(grid):,}", file=sys.stderr)

    rows.sort(key=lambda r: hashlib.sha256(
        f"{r['source']}/{r['id']}".encode("utf-8")).hexdigest())
    sample = rows[: args.sample]
    print(f"標本 {len(sample):,} 行（SHA-256 順）", file=sys.stderr)

    matcher = CategoryMatcher()
    # [行数, カテゴリが付いた, カテゴリ延べ, 近傍数の合計]
    by_tier: dict[str, list] = collections.defaultdict(lambda: [0, 0, 0, 0])
    by_tier_link: dict[tuple[str, bool], list] = collections.defaultdict(lambda: [0, 0])

    for i, r in enumerate(sample, 1):
        cy, cx = cell_of(r["lat"], r["lon"])
        n_near = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for plat, plon in grid.get((cy + dy, cx + dx), ()):
                    if haversine_km(r["lat"], r["lon"], plat, plon) <= RADIUS_KM:
                        n_near += 1
        tier = tier_of(n_near)
        cats = {c["dish_category_id"] for c in matcher.match(r["name"])}
        b = by_tier[tier]
        b[0] += 1
        b[3] += n_near
        if cats:
            b[1] += 1
            b[2] += len(cats)
        lb = by_tier_link[(tier, r["has_link"])]
        lb[0] += 1
        if cats:
            lb[1] += 1
        if i % 50000 == 0:
            print(f"  ... {i:,}/{len(sample):,}", file=sys.stderr)

    print(f"\n=== 店名からの dish_category 付与率（tier 別）===", file=sys.stderr)
    print(f"{'tier':10}{'行数':>10}{'カテゴリ付き':>12}{'率':>9}{'95%CI':>16}"
          f"{'k':>7}{'実測密度':>10}{'センサス':>9}", file=sys.stderr)
    out_tier = {}
    for tier in ("urban", "suburban", "rural"):
        n, hit, cats, dens = by_tier[tier]
        if n == 0:
            continue
        lo, hi = wilson(hit, n)
        out_tier[tier] = {"n": n, "n_hit": hit, "rate": hit / n, "wilson": [lo, hi],
                          "k": cats / max(hit, 1), "mean_density": dens / n,
                          "census_density": CENSUS[tier]}
        print(f"{tier:10}{n:>10,}{hit:>12,}{hit / n * 100:>8.2f}%"
              f"{f'{lo*100:.2f}-{hi*100:.2f}%':>16}{cats / max(hit,1):>7.2f}"
              f"{dens / n:>10.1f}{CENSUS[tier]:>9.2f}", file=sys.stderr)

    rates = [out_tier[t]["rate"] for t in out_tier]
    spread = (max(rates) - min(rates)) * 100 if rates else 0.0
    print(f"\n  **tier 間の差は {spread:.2f}pt**（密度は "
          f"{out_tier.get('urban', {}).get('mean_density', 0):.0f} 対 "
          f"{out_tier.get('rural', {}).get('mean_density', 0):.1f} で "
          f"{out_tier.get('urban', {}).get('mean_density', 1) / max(out_tier.get('rural', {}).get('mean_density', 1), 1e-9):.0f}倍差）",
          file=sys.stderr)

    print(f"\n=== tier × リンクの有無 ===", file=sys.stderr)
    out_link = {}
    for tier in ("urban", "suburban", "rural"):
        for has_link in (True, False):
            n, hit = by_tier_link[(tier, has_link)]
            if n == 0:
                continue
            key = f"{tier}/{'link' if has_link else 'nolink'}"
            out_link[key] = {"n": n, "n_hit": hit, "rate": hit / n}
            print(f"  {key:20}{n:>9,}{hit / n * 100:>9.2f}%", file=sys.stderr)

    print("\n  ※ tier は fixtures に無いので座標から半径1km内の母集団店舗数で割った。"
          "\n     閾値は密度センサスの隣り合う平均の幾何平均（urban>=74 / suburban>=13）。"
          "\n     割った後の実測密度をセンサスと並べてあるので妥当性は確認できる。",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "name_route_by_tier.json"
    out_path.write_text(
        json.dumps({"n_population": len(rows), "n_sample": len(sample),
                    "radius_km": RADIUS_KM,
                    "thresholds": {"urban_min": URBAN_MIN, "suburban_min": SUBURBAN_MIN},
                    "census": CENSUS, "by_tier": out_tier, "by_tier_link": out_link,
                    "spread_pt": spread,
                    "caveat": "tier は座標密度から自前で割ったもの。閾値の決め方は"
                              "docstring に明記。カテゴリ付与は店名のみ（外部アクセス無し）。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
