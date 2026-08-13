#!/usr/bin/env python3
"""既存 `public.restaurants` の何割がオープンデータ側に存在するかを測る。

これは名寄せの精度とは別の問いである。「Google に載っていて自社が実際に使っている店」
のうち、どれだけが Overture Maps に載っているか。ここが低いと、いくら名寄せを
改善しても取りこぼす店が構造的に残るので、seed の調達方法から見直す必要がある。

各 restaurants 行を、近傍の Overture 行と突き合わせて3つに分ける。

- covered      : 近傍に、名称も一致する Overture 行がある
- nearby_only  : 近傍に Overture 行はあるが、名称が一致しない
                 （店名表記の違いか、その店自体は載っていないかのどちらか）
- absent       : 近傍に Overture 行が1件も無い（明確に未収録）
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from ground_truth import haversine_m, load_restaurants
from jp_text import name_similarity
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--radius-m", type=float, default=100.0)
    parser.add_argument("--min-name-similarity", type=float, default=0.78)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    restaurants, restaurant_stats = load_restaurants(arguments.restaurants)
    cell = arguments.radius_m / 111_320.0
    grid: dict[tuple[int, int], list] = {}
    seed_count = 0
    for seed in read_seeds(arguments.seeds):
        seed_count += 1
        grid.setdefault((int(seed.latitude / cell), int(seed.longitude / cell)), []).append(seed)

    verdicts: Counter = Counter()
    similarity_histogram: Counter = Counter()
    distances: list[float] = []
    for truth in restaurants.values():
        base = (int(truth.latitude / cell), int(truth.longitude / cell))
        best_similarity = 0.0
        nearest = None
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for seed in grid.get((base[0] + d_lat, base[1] + d_lon), []):
                    distance = haversine_m(
                        seed.latitude, seed.longitude, truth.latitude, truth.longitude
                    )
                    if distance > arguments.radius_m:
                        continue
                    if nearest is None or distance < nearest:
                        nearest = distance
                    best_similarity = max(best_similarity, name_similarity(seed.name, truth.name))
        if nearest is not None:
            similarity_histogram[round(min(best_similarity, 0.999) * 10) / 10] += 1
        if nearest is None:
            verdicts["absent"] += 1
        elif best_similarity >= arguments.min_name_similarity:
            verdicts["covered"] += 1
            distances.append(nearest)
        else:
            verdicts["nearby_only"] += 1

    total = sum(verdicts.values())
    report = {
        "restaurants": restaurant_stats,
        "overture_seeds": seed_count,
        "radius_m": arguments.radius_m,
        "min_name_similarity": arguments.min_name_similarity,
        "verdicts": dict(verdicts),
        "coverage_rate": round(verdicts["covered"] / total, 6) if total else 0.0,
        # 名称一致のしきい値をいくつにするかで網羅率は動く。1回の計算で読み取れるよう、
        # 近傍に Overture 行があった restaurants の「最良の名称類似度」の分布を出す。
        "best_similarity_histogram": dict(sorted(similarity_histogram.items())),
        "coverage_by_threshold": {
            str(threshold / 10): round(
                sum(count for value, count in similarity_histogram.items() if value >= threshold / 10)
                / total,
                6,
            )
            for threshold in range(0, 10)
        },
        # 密集地では無関係な店でも100m以内に必ず何かがあるため、これは網羅率ではない。
        "any_overture_row_within_radius": (
            round((verdicts["covered"] + verdicts["nearby_only"]) / total, 6) if total else 0.0
        ),
    }
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
