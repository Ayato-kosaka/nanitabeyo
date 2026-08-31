#!/usr/bin/env python3
"""Google 側の飲食店の密度を無料で数え、オープンデータの密度と直接比べる。

これまでの網羅率は「既存DB 103,440行のうち、近傍に名前の一致するオープンデータ行が
あるものの割合」だった。この測り方には2つの弱点がある。

- 分母が既存DBである。既存DBは bulk-import の一回きりのスナップショットで、
  Google が持っている店を全部は持っていない。
- 店名照合器の出来に左右される。実際、照合器を直しただけで 48.76% が 72.83% になった。

Nearby Search は Text Search とは別の日次クォータを持つ。円の中の place_id を店名なしで列挙できるので、
**同じ円の中で Google が何件持ち、オープンデータが何件持つか**を直接数えられる。
名前を一切使わないので、照合器の出来に影響されない。

20件で打ち切られる制約があるので、20件ちょうどなら半径を半分にして数え直す。
打ち切られたまま数えると Google 側を過小評価してしまう。
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
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from free_places import FreePlacesClient, RateLimiter
from ground_truth import haversine_m, load_restaurants
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

MAX_RESULTS = 20
# Places API (New) の type のうち飲食に当たるもの。指定しないと ATM や美容室まで
# 返ってきて、Google 側の件数を水増ししてしまう。
FOOD_TYPES = (
    "restaurant", "cafe", "bar", "bakery", "coffee_shop", "fast_food_restaurant",
    "meal_takeaway", "meal_delivery", "ice_cream_shop", "sandwich_shop",
    "pizza_restaurant", "ramen_restaurant", "sushi_restaurant", "japanese_restaurant",
    "chinese_restaurant", "italian_restaurant", "steak_house", "buffet_restaurant",
    "breakfast_restaurant", "brunch_restaurant", "dessert_shop", "pub", "wine_bar",
)


def nearby_body(latitude: float, longitude: float, radius_m: float) -> dict:
    return {
        "languageCode": "ja",
        "regionCode": "JP",
        "maxResultCount": MAX_RESULTS,
        "rankPreference": "DISTANCE",
        "includedTypes": list(FOOD_TYPES),
        "locationRestriction": {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": radius_m,
            }
        },
    }


@dataclass
class Probe:
    latitude: float
    longitude: float
    radius_m: float
    google: int
    open_data: int
    in_database: int
    truncated: bool


def count_google(
    client: FreePlacesClient, latitude: float, longitude: float, radius_m: float, floor_m: float
) -> tuple[set[str], float, bool]:
    """打ち切りに当たらなくなるまで半径を縮めて place_id を数える。"""

    radius = radius_m
    while True:
        result = client.search_nearby(nearby_body(latitude, longitude, radius))
        if not result.ok:
            return set(), radius, True
        identifiers = set(result.place_ids)
        if len(identifiers) < MAX_RESULTS or radius <= floor_m:
            return identifiers, radius, len(identifiers) >= MAX_RESULTS
        radius /= 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True, help="標本の中心を選ぶ元")
    parser.add_argument(
        "--all-seeds",
        type=Path,
        help="密度を数えるオープンデータ全件。省略すると --seeds を使う（標本で数えると過小になる）",
    )
    parser.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    parser.add_argument("--points", type=int, default=200)
    parser.add_argument("--radius-m", type=float, default=120.0)
    parser.add_argument("--floor-m", type=float, default=20.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--qps", type=float, default=6.0)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")

    centre_pool = list(read_seeds(arguments.seeds))
    random.seed(arguments.seed)
    # 店のある場所を標本の中心にする。無人の山中を数えても意味がない。
    centres = random.sample(centre_pool, min(arguments.points, len(centre_pool)))
    # 密度は必ず全件から数える。標本から数えると、円の中に中心の1件しか無い、
    # という当たり前の結果になる（実際に一度そうなった）。
    everything = list(read_seeds(arguments.all_seeds)) if arguments.all_seeds else centre_pool

    # 近傍を数えるためのグリッド。半径は最大でも --radius-m なのでその粒度でよい。
    cell = arguments.radius_m / 111_320.0
    grid: dict[tuple[int, int], list] = {}
    for item in everything:
        grid.setdefault((int(item.latitude / cell), int(item.longitude / cell)), []).append(item)
    restaurants, _ = load_restaurants(arguments.restaurants)
    database_grid: dict[tuple[int, int], list] = {}
    for row in restaurants.values():
        database_grid.setdefault(
            (int(row.latitude / cell), int(row.longitude / cell)), []
        ).append(row)

    def within(source: dict, latitude: float, longitude: float, radius: float) -> list:
        base = (int(latitude / cell), int(longitude / cell))
        found = []
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for item in source.get((base[0] + d_lat, base[1] + d_lon), ()):
                    if haversine_m(item.latitude, item.longitude, latitude, longitude) <= radius:
                        found.append(item)
        return found

    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(qps=arguments.qps))
    probes: list[Probe] = []
    known_place_ids = set(restaurants)
    matched_in_database = 0
    google_total = 0

    for index, centre in enumerate(centres, 1):
        identifiers, radius, truncated = count_google(
            client, centre.latitude, centre.longitude, arguments.radius_m, arguments.floor_m
        )
        open_data = within(grid, centre.latitude, centre.longitude, radius)
        in_database = within(database_grid, centre.latitude, centre.longitude, radius)
        probes.append(
            Probe(centre.latitude, centre.longitude, radius, len(identifiers),
                  len(open_data), len(in_database), truncated)
        )
        google_total += len(identifiers)
        matched_in_database += len(identifiers & known_place_ids)
        if index % 25 == 0:
            print(f"  {index}/{len(centres)} リクエスト {client.request_count}", flush=True)

    usable = [probe for probe in probes if not probe.truncated]
    google_sum = sum(probe.google for probe in usable)
    open_sum = sum(probe.open_data for probe in usable)
    database_sum = sum(probe.in_database for probe in usable)
    report = {
        "points": len(probes),
        "usable_points": len(usable),
        "truncated_points": len(probes) - len(usable),
        "google_places": google_sum,
        "open_data_rows": open_sum,
        "database_rows": database_sum,
        # 円の中の件数比。名前を一切使っていないので照合器の出来に影響されない。
        "open_data_per_google": round(open_sum / google_sum, 4) if google_sum else 0.0,
        "database_per_google": round(database_sum / google_sum, 4) if google_sum else 0.0,
        # Google が返した place_id のうち、既存DBに実在したもの。
        "google_ids_present_in_database": matched_in_database,
        "google_ids_seen": google_total,
        "database_hit_rate": round(matched_in_database / google_total, 4) if google_total else 0.0,
        "radius_histogram": dict(Counter(round(probe.radius_m) for probe in probes)),
        "requests": client.request_count,
        "http_errors": client.error_count,
        "sku": "Nearby Search Pro (New) — 課金対象。#1331 参照",
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
