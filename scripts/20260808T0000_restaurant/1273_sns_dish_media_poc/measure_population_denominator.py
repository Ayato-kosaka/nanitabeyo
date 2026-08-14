#!/usr/bin/env python3
"""#1273 【訂正】カバレッジの分母は Overture 単独ではない。統合母集団で測り直す

## なぜ書いたか

直前に「Meta 経路の経路存在率 87.04%、70% に届く唯一の経路」と報告したが、
**分母が Overture 789,612 だけだった**。#843 の母集団は
Overture + IFAS + OSM の3ソースであり、①のクロールでも
**1,234 店が「Overture に無く IFAS/OSM にだけ在る」**として実際に発見されている。
つまり統合母集団は Overture より大きく、あらゆるカバレッジ%はその分小さくなる。

本PoCの過去ラウンドの数字（48.0% など）も同じ Overture 分母で出しているので、
経路どうしの相対比較は保たれる。**壊れるのは「70% に届く」という絶対判定のほう。**

## 母集団の上下限

厳密な重複排除ができない以上、1つの数字にはならない。上下から挟む。

- **上限**（重複を最大限「別店」と見なす）: 正規化名 + 座標100m が一致する行だけを同一視。
  名寄せの表記ゆれ（「や台ずし」vs「ヤタイズシ」等）は別店として残る。
- **下限**（重複を最大限「同一店」と見なす）: 上記に加え、名前が違っても
  **100m 以内に Overture の店がある行は全て重複**と見なす。
  都市部では同じビルに別の店が入るため、これは重複を過大に見積もる。

真の母集団はこの間にある。

実行:
    python3 measure_population_denominator.py
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

COORD_PRECISION = 3  # 小数3桁 ≒ 100m
CELL = 0.001
RADIUS_M = 100.0

# measure_overture_facebook_link.py / measure_facebook_link_by_tier.py の実測。
META_REACHABLE = 701_284
OVERTURE_ONLY_CLAIM_PCT = 87.04
OWNER_TARGET_PCT = 70.0


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

    overture_keys: set[tuple] = set()
    grid: dict[tuple[int, int], list[tuple[float, float]]] = collections.defaultdict(list)
    for name, lat, lon in read_rows(SOURCES[0]):
        overture_keys.add((name_key(name), round(lat, COORD_PRECISION), round(lon, COORD_PRECISION)))
        grid[(int(lat / CELL), int(lon / CELL))].append((lat, lon))
    overture_n = len(overture_keys)
    print(f"Overture の distinct（名前+座標100m）: {overture_n:,}", file=sys.stderr)

    def has_neighbor(lat: float, lon: float) -> bool:
        cy, cx = int(lat / CELL), int(lon / CELL)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for a, b in grid.get((cy + dy, cx + dx), ()):
                    dist = math.hypot(
                        (a - lat) * 111_320,
                        (b - lon) * 111_320 * math.cos(math.radians(lat)),
                    )
                    if dist <= RADIUS_M:
                        return True
        return False

    seen = set(overture_keys)
    per_source = []
    added_strict = 0
    added_loose = 0
    for filename in SOURCES[1:]:
        new = 0
        colocated = 0
        for name, lat, lon in read_rows(filename):
            key = (name_key(name), round(lat, COORD_PRECISION), round(lon, COORD_PRECISION))
            if key in seen:
                continue
            seen.add(key)
            new += 1
            if has_neighbor(lat, lon):
                colocated += 1
        added_strict += new
        added_loose += new - colocated
        per_source.append(
            {"source": filename, "new_strict": new, "colocated_with_overture": colocated,
             "new_loose": new - colocated,
             "colocated_pct": colocated / new * 100 if new else 0.0}
        )
        print(
            f"{filename:24} 名前+座標で新規 {new:>8,} / "
            f"100m以内にOverture店あり {colocated:>8,} "
            f"({colocated / new * 100 if new else 0:.2f}%)",
            file=sys.stderr,
        )

    upper = overture_n + added_strict
    lower = overture_n + added_loose

    print("\n=== 統合母集団の上下限 ===", file=sys.stderr)
    print(f"  上限（表記ゆれを別店として残す）: {upper:,}", file=sys.stderr)
    print(f"  下限（100m以内を全て重複と見なす）: {lower:,}", file=sys.stderr)
    print(f"  ※ 都市部は同一ビルに別店が入るため、下限は重複を過大に見積もっている",
          file=sys.stderr)

    cov_low = META_REACHABLE / upper * 100
    cov_high = META_REACHABLE / lower * 100
    print("\n=== 【訂正】Meta 経路のカバレッジ ===", file=sys.stderr)
    print(f"  Overture 分母での既報: {OVERTURE_ONLY_CLAIM_PCT:.2f}%", file=sys.stderr)
    print(f"  統合母集団での実際  : **{cov_low:.1f}% 〜 {cov_high:.1f}%**", file=sys.stderr)
    verdict = (
        "**下限が70%を割るので『70%に届く』とは断定できない**"
        if cov_low < OWNER_TARGET_PCT <= cov_high
        else ("70% を上回る" if cov_low >= OWNER_TARGET_PCT else "70% に届かない")
    )
    print(f"  オーナー要求 {OWNER_TARGET_PCT:.0f}% に対して: {verdict}", file=sys.stderr)
    print(
        "\n他経路の合算天井 48.0%（上限 50.3%）も同じ Overture 分母で出しているので、"
        "同様に縮む。経路どうしの相対比較は保たれ、Meta が最大であることは変わらない。"
        "**壊れるのは「70%に届く」という絶対判定のほう。**",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "population_denominator.json"
    out_path.write_text(
        json.dumps(
            {
                "overture_distinct": overture_n,
                "per_source": per_source,
                "population_upper": upper,
                "population_lower": lower,
                "meta_reachable": META_REACHABLE,
                "meta_coverage_pct_low": cov_low,
                "meta_coverage_pct_high": cov_high,
                "previously_reported_pct": OVERTURE_ONLY_CLAIM_PCT,
                "owner_target_pct": OWNER_TARGET_PCT,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
