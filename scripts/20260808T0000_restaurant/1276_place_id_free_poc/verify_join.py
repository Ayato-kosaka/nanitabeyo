#!/usr/bin/env python3
"""results/matched_place_ids.csv を既存 restaurants と google_place_id で突合する。

README/REPORT.md が指示する検証手順を実装する: 判定は店名の一致ではなく、
Overture 側の座標(matched CSV)と Google 側の座標(restaurants)の距離で行う。
distance_m が小さいほど、無料SKUで逆引きした google_place_id が実在の同一店舗を
指している確度が高い。
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

EARTH_RADIUS_M = 6_371_000.0
# REPORT.md の座標裏取り矩形(半辺75m/250m)に合わせた読み方用のしきい値。
DISTANCE_BUCKETS_M = (75, 250, 1000)


def parse_args() -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="matched_place_ids.csv を restaurants と google_place_id で突合します"
    )
    parser.add_argument("--matched", type=Path, default=here / "results" / "matched_place_ids.csv")
    parser.add_argument("--restaurants", type=Path, default=here / "out" / "restaurants.csv")
    parser.add_argument("--output", type=Path, default=here / "out" / "verify_join.csv")
    parser.add_argument("--summary-output", type=Path, default=here / "out" / "verify_summary.json")
    return parser.parse_args()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(min(1.0, a)))


def load_restaurants(path: Path) -> dict:
    by_place_id: dict = {}
    duplicate_place_ids = 0
    with path.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            place_id = row["google_place_id"]
            if place_id in by_place_id:
                duplicate_place_ids += 1
                continue
            by_place_id[place_id] = {
                "id": row["id"],
                "name": row["name"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "created_at": row["created_at"],
            }
    if duplicate_place_ids:
        print(
            f"警告: restaurants.google_place_id の重複を{duplicate_place_ids}件スキップしました",
            file=sys.stderr,
        )
    return by_place_id


def bucket_label(distance_m: float) -> str:
    for threshold in DISTANCE_BUCKETS_M:
        if distance_m <= threshold:
            return f"<={threshold}m"
    return f">{DISTANCE_BUCKETS_M[-1]}m"


def main() -> None:
    args = parse_args()
    restaurants = load_restaurants(args.restaurants)

    fieldnames = [
        "overture_id",
        "google_place_id",
        "overture_name",
        "confidence_tier",
        "match_detail",
        "joined",
        "restaurant_id",
        "restaurant_name",
        "distance_m",
        "distance_bucket",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    joined = 0
    tier_counts: dict = {}
    bucket_counts: dict = {}
    distances: list = []

    with args.matched.open(encoding="utf-8", newline="") as in_stream, args.output.open(
        "w", encoding="utf-8", newline=""
    ) as out_stream:
        reader = csv.DictReader(in_stream)
        writer = csv.DictWriter(out_stream, fieldnames=fieldnames)
        writer.writeheader()

        for row in reader:
            total += 1
            tier = row["confidence_tier"]
            place_id = row["google_place_id"]
            restaurant = restaurants.get(place_id)
            tier_counts.setdefault(tier, {"total": 0, "joined": 0})
            tier_counts[tier]["total"] += 1

            out_row = {
                "overture_id": row["overture_id"],
                "google_place_id": place_id,
                "overture_name": row["name"],
                "confidence_tier": tier,
                "match_detail": row["match_detail"],
                "joined": False,
                "restaurant_id": "",
                "restaurant_name": "",
                "distance_m": "",
                "distance_bucket": "",
            }

            if restaurant is not None:
                joined += 1
                tier_counts[tier]["joined"] += 1
                distance_m = haversine_m(
                    float(row["latitude"]),
                    float(row["longitude"]),
                    restaurant["latitude"],
                    restaurant["longitude"],
                )
                bucket = bucket_label(distance_m)
                distances.append(distance_m)
                bucket_counts.setdefault(tier, {}).setdefault(bucket, 0)
                bucket_counts[tier][bucket] += 1

                out_row.update(
                    {
                        "joined": True,
                        "restaurant_id": restaurant["id"],
                        "restaurant_name": restaurant["name"],
                        "distance_m": f"{distance_m:.1f}",
                        "distance_bucket": bucket,
                    }
                )

            writer.writerow(out_row)

    distances.sort()

    def percentile(p: float) -> float:
        if not distances:
            return float("nan")
        index = min(len(distances) - 1, int(len(distances) * p))
        return distances[index]

    summary = {
        "matched_rows": total,
        "joined_rows": joined,
        "join_rate": joined / total if total else 0.0,
        "distance_stats_m": {
            "count": len(distances),
            "min": distances[0] if distances else None,
            "p50": percentile(0.50),
            "p90": percentile(0.90),
            "p99": percentile(0.99),
            "max": distances[-1] if distances else None,
        },
        "by_confidence_tier": {
            tier: {
                "total": counts["total"],
                "joined": counts["joined"],
                "join_rate": counts["joined"] / counts["total"] if counts["total"] else 0.0,
                "distance_buckets": bucket_counts.get(tier, {}),
            }
            for tier, counts in sorted(tier_counts.items())
        },
    }

    args.summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"restaurants loaded: {len(restaurants)} unique google_place_id")
    print(f"matched rows: {total}, joined: {joined} ({summary['join_rate']:.2%})")
    print(json.dumps(summary["distance_stats_m"], ensure_ascii=False, indent=2))
    for tier, stats in summary["by_confidence_tier"].items():
        print(f"tier {tier}: {stats['joined']}/{stats['total']} joined ({stats['join_rate']:.2%})")
        print(f"  distance buckets: {stats['distance_buckets']}")
    print(f"joined CSV -> {args.output}")
    print(f"summary JSON -> {args.summary_output}")


if __name__ == "__main__":
    main()
