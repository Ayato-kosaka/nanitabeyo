#!/usr/bin/env python3
"""#1273 反証: 「カメラロール考古学」が狙うリンク無し層は、GPSで一意特定できる所に居るのか。

提案の主張は「リンク無し層 343,247店（30.31%）に構造的に届くのはこの経路だけ」。
リンク無し層の定義は measure_facility_tenant.py と揃える
（正規化屋号+座標3桁で名寄せし、どのソース行にも website/social が無い場所）。

測る軸:
  軸1: リンク無し層の GPS 一意特定率（半径25m/50mで単独か）
  軸2: リンク無し層の 1km セル密度（過疎地か都心か）

出力: out/cameraroll_linkless_density.json
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
CELL_DEG = 0.001
KM = 0.01


def norm_key(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def as_int(v) -> int:
    v = (v or "").strip()
    try:
        return int(float(v))
    except ValueError:
        return 0


def main() -> None:
    csv.field_size_limit(10**7)

    places: dict[tuple, dict] = {}
    for filename in SOURCES:
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
                k = norm_key(name)
                if not k:
                    continue
                has_link = as_int(row.get("n_socials")) > 0 or as_int(row.get("n_websites")) > 0
                pk = (k, round(lat, 3), round(lon, 3))
                cur = places.get(pk)
                if cur is None:
                    places[pk] = {"lat": lat, "lon": lon, "has_link": has_link}
                else:
                    cur["has_link"] = cur["has_link"] or has_link

    plist = list(places.values())
    n = len(plist)
    n_nolink = sum(1 for p in plist if not p["has_link"])
    print(f"重複除去後の店: {n:,}  うちリンク無し {n_nolink:,} ({n_nolink/n*100:.2f}%)",
          file=sys.stderr)

    grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    kmcell: collections.Counter = collections.Counter()
    for i, p in enumerate(plist):
        grid[(int(math.floor(p["lat"] / CELL_DEG)), int(math.floor(p["lon"] / CELL_DEG)))].append(i)
        kmcell[(int(math.floor(p["lat"] / KM)), int(math.floor(p["lon"] / KM)))] += 1

    stats = {
        lbl: {"n": 0, "alone25": 0, "alone50": 0, "nb25": 0, "nb50": 0,
              "km": collections.Counter()}
        for lbl in ("linked", "linkless")
    }

    for i, p in enumerate(plist):
        if i % 300_000 == 0:
            print(f"  ... {i:,}/{n:,}", file=sys.stderr)
        lat, lon = p["lat"], p["lon"]
        cy, cx = int(math.floor(lat / CELL_DEG)), int(math.floor(lon / CELL_DEG))
        coslat = math.cos(math.radians(lat))
        n25 = n50 = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((cy + dy, cx + dx), ()):
                    if j == i:
                        continue
                    q = plist[j]
                    d = math.hypot((q["lat"] - lat) * 111_320,
                                   (q["lon"] - lon) * 111_320 * coslat)
                    if d <= 25.0:
                        n25 += 1
                    if d <= 50.0:
                        n50 += 1
        b = stats["linked" if p["has_link"] else "linkless"]
        b["n"] += 1
        b["nb25"] += n25
        b["nb50"] += n50
        if n25 == 0:
            b["alone25"] += 1
        if n50 == 0:
            b["alone50"] += 1
        b["km"][kmcell[(int(math.floor(lat / KM)), int(math.floor(lon / KM)))]] += 1

    out: dict = {"population": n, "linkless_total": n_nolink}
    for lbl, b in stats.items():
        m = b["n"]
        km = b["km"]
        tot = sum(km.values()) or 1

        def pct(lo, hi):
            return sum(v for k, v in km.items() if lo <= k < hi) / tot * 100

        out[lbl] = {
            "n": m,
            "alone_25m_pct": b["alone25"] / m * 100,
            "alone_50m_pct": b["alone50"] / m * 100,
            "mean_neighbors_25m": b["nb25"] / m,
            "mean_neighbors_50m": b["nb50"] / m,
            "km_lt10": pct(0, 10),
            "km_10_50": pct(10, 50),
            "km_50_200": pct(50, 200),
            "km_ge200": pct(200, 10**9),
        }
        o = out[lbl]
        print(
            f"{lbl:9} n={m:>8,}  単独25m {o['alone_25m_pct']:5.2f}%  単独50m {o['alone_50m_pct']:5.2f}%"
            f"  平均近傍25m {o['mean_neighbors_25m']:6.2f} / 50m {o['mean_neighbors_50m']:6.2f}"
            f"  |1kmセル: <10店 {o['km_lt10']:5.2f}%  10-50 {o['km_10_50']:5.2f}%"
            f"  50-200 {o['km_50_200']:5.2f}%  >=200 {o['km_ge200']:5.2f}%",
            file=sys.stderr,
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cameraroll_linkless_density.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote out/cameraroll_linkless_density.json", file=sys.stderr)


if __name__ == "__main__":
    main()
