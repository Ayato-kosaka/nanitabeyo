#!/usr/bin/env python3
"""#1273 反証: 「カメラロール考古学」の GPS 一意特定率と密集分布を実測する。

提案の測り方①②をそのまま実行する。
① 統合母集団の各店について、半径 25m / 50m 以内に他の飲食店POIが何件あるか。
   単独 = GPS だけで一意特定できる店。
② 1km セルあたり店舗数の分布。密集セルが母集団の何%か。

出力: out/cameraroll_gps_uniqueness.json
"""

from __future__ import annotations

import collections
import csv
import json
import math
import sys
from pathlib import Path

from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")
COORD_PRECISION = 3

RADII = (25.0, 50.0, 100.0)
CELL_DEG = 0.001  # ≒111m


def name_key(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def read_rows(filename: str):
    with (FIXTURES / filename).open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("name") or "").strip()
            if not name:
                continue
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (TypeError, ValueError):
                continue
            yield name, lat, lon


def main() -> None:
    csv.field_size_limit(10**7)

    seen: set[tuple] = set()
    pts: list[tuple[float, float]] = []
    for filename in SOURCES:
        for name, lat, lon in read_rows(filename):
            key = (name_key(name), round(lat, COORD_PRECISION), round(lon, COORD_PRECISION))
            if key in seen:
                continue
            seen.add(key)
            pts.append((lat, lon))
    n = len(pts)
    print(f"統合母集団（strict distinct）: {n:,}", file=sys.stderr)

    grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    for i, (lat, lon) in enumerate(pts):
        grid[(int(math.floor(lat / CELL_DEG)), int(math.floor(lon / CELL_DEG)))].append(i)

    # 半径ごとの近傍数
    counts = {r: collections.Counter() for r in RADII}
    maxr = max(RADII)
    span = int(math.ceil(maxr / 111_320 / CELL_DEG)) + 1

    for i, (lat, lon) in enumerate(pts):
        if i % 200_000 == 0:
            print(f"  ... {i:,}/{n:,}", file=sys.stderr)
        cy = int(math.floor(lat / CELL_DEG))
        cx = int(math.floor(lon / CELL_DEG))
        coslat = math.cos(math.radians(lat))
        near = {r: 0 for r in RADII}
        for dy in range(-span, span + 1):
            for dx in range(-span, span + 1):
                for j in grid.get((cy + dy, cx + dx), ()):
                    if j == i:
                        continue
                    a, b = pts[j]
                    d = math.hypot((a - lat) * 111_320, (b - lon) * 111_320 * coslat)
                    for r in RADII:
                        if d <= r:
                            near[r] += 1
        for r in RADII:
            counts[r][near[r]] += 1

    result: dict = {"population": n, "radii": {}}
    for r in RADII:
        c = counts[r]
        alone = c[0]
        le1 = c[0] + c[1]
        le4 = sum(v for k, v in c.items() if k <= 4)
        tot_nb = sum(k * v for k, v in c.items())
        result["radii"][str(int(r))] = {
            "alone": alone,
            "alone_pct": alone / n * 100,
            "at_most_1_other": le1,
            "at_most_1_other_pct": le1 / n * 100,
            "at_most_4_others": le4,
            "at_most_4_others_pct": le4 / n * 100,
            "mean_neighbors": tot_nb / n,
            "hist_head": {str(k): c[k] for k in range(0, 11)},
        }
        print(
            f"半径 {int(r):>3}m: 単独 {alone:,} ({alone/n*100:.2f}%) / "
            f"他1店以下 {le1/n*100:.2f}% / 平均近傍 {tot_nb/n:.2f}",
            file=sys.stderr,
        )

    # ② 1km セルあたり店舗数分布（0.01 度 ≒ 1.1km）
    KM = 0.01
    kmcell: collections.Counter = collections.Counter()
    for lat, lon in pts:
        kmcell[(int(math.floor(lat / KM)), int(math.floor(lon / KM)))] += 1
    sizes = sorted(kmcell.values())
    ncells = len(sizes)
    # 店を単位にした分布（店から見て自分のセルに何店あるか）
    store_in_cell = []
    for k, v in kmcell.items():
        store_in_cell.extend([v] * v)
    store_in_cell.sort()

    def pct_stores_in_cells_over(t: int) -> float:
        return sum(1 for v in store_in_cell if v >= t) / n * 100

    result["km_cells"] = {
        "n_cells": ncells,
        "median_stores_per_cell": sizes[ncells // 2],
        "mean_stores_per_cell": n / ncells,
        "p90_stores_per_cell": sizes[int(ncells * 0.9)],
        "p99_stores_per_cell": sizes[int(ncells * 0.99)],
        "pct_stores_in_cells_ge_50": pct_stores_in_cells_over(50),
        "pct_stores_in_cells_ge_100": pct_stores_in_cells_over(100),
        "pct_stores_in_cells_ge_500": pct_stores_in_cells_over(500),
    }
    print(
        f"1kmセル: {ncells:,}セル / 中央値 {sizes[ncells//2]} 店 / "
        f"店の {pct_stores_in_cells_over(100):.1f}% が 100店以上のセルに居る",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cameraroll_gps_uniqueness.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote out/cameraroll_gps_uniqueness.json", file=sys.stderr)


if __name__ == "__main__":
    main()
