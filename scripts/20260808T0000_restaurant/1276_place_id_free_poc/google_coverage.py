#!/usr/bin/env python3
"""Google の飲食店のうち、オープンデータに対応行が無いものの割合を無料で測る。

これまでの「網羅率」は既存DB 103,440行を分母にしていた。しかし既存DBは Google の
飲食店の 12.75% しか持っていない（`density.py` の実測）。つまり分母が小さすぎて、
「オープンデータが Google をどれだけ覆えているか」を測れていなかった。

Nearby Search は円の中の place_id を店名なしで返す。半径を十分小さくすれば、**返ってきた place_id はその半径以内にある**ことが
分かる。座標フィールドを買わずに位置を絞れる。

そこで小さい円で区画を敷き詰め、

1. Google 側の place_id を、おおよその位置つきで列挙する
2. 各 place_id の近くにオープンデータ行があるかを数える

とすれば、店名照合にも既存DBにも依存しない網羅率が出る。これがオープンデータで
Google Maps を置き換えられるかの、最も直接的な答えになる。

打ち切り（20件）に当たった円は、そこに20件以上あるという事実だけが分かる。
位置の推定が甘くなるので、集計から外して件数だけ記録する。
"""

# **このスクリプトは課金される。** Nearby Search (New) には IDs Only の無料枠が無く、
# fieldMask を places.id だけにしても Nearby Search Pro として課金される
# （Google サポートの回答、#1331）。当初これを無料だと誤認して実行した。
# `FreePlacesClient.search_nearby` は現在 BillableEndpointError を送出するので、
# このスクリプトはそのままでは動かない。測定結果は残すが、再実行してはならない。


from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

from density import FOOD_TYPES, MAX_RESULTS, nearby_body
from free_places import FreePlacesClient, RateLimiter
from ground_truth import haversine_m
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def block_centres(
    latitude: float, longitude: float, half_side_m: float, spacing_m: float
) -> list[tuple[float, float]]:
    """1区画を格子状の円で覆う中心点を作る。"""

    lat_step = spacing_m / 111_320.0
    lon_step = spacing_m / (111_320.0 * max(math.cos(math.radians(latitude)), 0.01))
    steps = int(half_side_m / spacing_m)
    return [
        (latitude + row * lat_step, longitude + column * lon_step)
        for row in range(-steps, steps + 1)
        for column in range(-steps, steps + 1)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True, help="区画の中心を選ぶ元")
    parser.add_argument("--all-seeds", type=Path, required=True, help="近傍判定に使う全件")
    parser.add_argument("--blocks", type=int, default=12, help="敷き詰める区画の数")
    parser.add_argument("--half-side-m", type=float, default=70.0, help="区画の半辺")
    parser.add_argument("--spacing-m", type=float, default=35.0, help="円の間隔")
    parser.add_argument("--radius-m", type=float, default=25.0, help="円の半径")
    parser.add_argument("--match-radius-m", type=float, default=40.0,
                        help="place_id の推定位置からこの距離内にオープンデータ行があれば対応ありとする")
    parser.add_argument("--seed", type=int, default=5)
    parser.add_argument("--qps", type=float, default=6.0)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")

    pool = list(read_seeds(arguments.seeds))
    random.seed(arguments.seed)
    blocks = random.sample(pool, min(arguments.blocks, len(pool)))

    everything = list(read_seeds(arguments.all_seeds))
    cell = 200.0 / 111_320.0
    grid: dict[tuple[int, int], list] = {}
    for item in everything:
        grid.setdefault((int(item.latitude / cell), int(item.longitude / cell)), []).append(item)

    def nearest_open_data(latitude: float, longitude: float) -> float | None:
        base = (int(latitude / cell), int(longitude / cell))
        best = None
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for item in grid.get((base[0] + d_lat, base[1] + d_lon), ()):
                    distance = haversine_m(item.latitude, item.longitude, latitude, longitude)
                    if best is None or distance < best:
                        best = distance
        return best

    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(qps=arguments.qps))
    # place_id -> それが返ってきた円の中心。重心をその place_id の推定位置とする。
    sightings: dict[str, list[tuple[float, float]]] = defaultdict(list)
    truncated_circles = 0
    circles = 0

    for index, block in enumerate(blocks, 1):
        for latitude, longitude in block_centres(
            block.latitude, block.longitude, arguments.half_side_m, arguments.spacing_m
        ):
            result = client.search_nearby(
                nearby_body(latitude, longitude, arguments.radius_m)
            )
            circles += 1
            if not result.ok:
                continue
            if len(result.place_ids) >= MAX_RESULTS:
                truncated_circles += 1
            for identifier in result.place_ids:
                sightings[identifier].append((latitude, longitude))
        print(
            f"  区画 {index}/{len(blocks)}  円 {circles}  place_id {len(sightings)}"
            f"  リクエスト {client.request_count}",
            flush=True,
        )

    distances: list[float] = []
    verdicts: Counter = Counter()
    rows: list[dict] = []
    for identifier, seen in sightings.items():
        latitude = sum(point[0] for point in seen) / len(seen)
        longitude = sum(point[1] for point in seen) / len(seen)
        nearest = nearest_open_data(latitude, longitude)
        if nearest is None:
            verdicts["近傍にオープンデータ行なし"] += 1
        else:
            distances.append(nearest)
            if nearest <= arguments.match_radius_m:
                verdicts["対応行あり"] += 1
            else:
                verdicts["対応行なし"] += 1
        rows.append(
            {
                "place_id": identifier,
                "latitude": f"{latitude:.7f}",
                "longitude": f"{longitude:.7f}",
                "sightings": len(seen),
                "nearest_open_data_m": "" if nearest is None else f"{nearest:.1f}",
            }
        )

    total = sum(verdicts.values())
    distances.sort()
    report = {
        "blocks": len(blocks),
        "circles": circles,
        "truncated_circles": truncated_circles,
        "google_places": total,
        "match_radius_m": arguments.match_radius_m,
        "verdicts": dict(verdicts),
        "coverage_rate": round(verdicts["対応行あり"] / total, 4) if total else 0.0,
        "nearest_distance_m": {
            "p50": distances[len(distances) // 2] if distances else None,
            "p90": distances[int(len(distances) * 0.9)] if distances else None,
        },
        "requests": client.request_count,
        "http_errors": client.error_count,
        "sku": "Nearby Search Pro (New) — 課金対象。#1331 参照",
    }
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        with arguments.output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(
                stream,
                fieldnames=["place_id", "latitude", "longitude", "sightings", "nearest_open_data_m"],
            )
            writer.writeheader()
            writer.writerows(rows)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
