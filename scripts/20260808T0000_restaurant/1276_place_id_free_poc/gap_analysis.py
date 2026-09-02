#!/usr/bin/env python3
"""主KPI（Google Maps の飲食店をどれだけ拾えているか）の**取りこぼし側**を分解する。

到達率だけ見ても打ち手が決まらない。取りこぼしが弁当屋・パン屋のような周辺業態なら
戦略的に対象外にできるし、本物の飲食店なら、オープンデータのソースを増やすしかない。
そこで、届かなかった place を次の順で調べる。

1. 既存 `public.restaurants`（Google 由来の10万件）に同じ place_id があれば、**店名が分かる**。
   Google から店名を買うと課金対象SKUになるが、これは手元にある。
2. その place の推定位置に最も近いオープンデータ行の名前と比べる。
   - 名前が一致する → オープンデータには在る。**名寄せの失敗**である。
   - 名前が違う → 近くの行は別の店。**オープンデータにその店が無い**。

密度の罠に注意すること。この測定に使う区画は繁華街なので、
「30m 以内にオープンデータ行がある」は 97.5% で成立するが、それは
**その店の行がある**という意味ではまったくない。距離だけを見てはいけない。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

from free_places import SearchResult
from jp_name_match import similarity
from matching import RULES, STATUS_MATCHED
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

CELL_DEGREES = 0.002
SAME_SHOP_SIMILARITY = 0.85
MAYBE_SIMILARITY = 0.50


def load_probes(path: Path) -> dict[str, dict[str, SearchResult]]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    probes: dict[str, dict[str, SearchResult]] = defaultdict(dict)
    for seed_id, probe, status, ids, error in connection.execute(
        "SELECT seed_id, probe, status, ids, error FROM probe"
    ):
        probes[seed_id][probe] = SearchResult(tuple(json.loads(ids)), status, error)
    connection.close()
    return probes


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return math.hypot(
        (lat1 - lat2) * 111_320.0,
        (lon1 - lon2) * 111_320.0 * math.cos(math.radians(lat1)),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enumerated", type=Path,
                        default=ROOT / "results" / "google_coverage_db.csv")
    parser.add_argument("--seeds", type=Path, required=True, help="区画内の seed")
    parser.add_argument("--corpus", type=Path, required=True, help="統合コーパス全件")
    parser.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rule", default="box_unique")
    parser.add_argument("--output", type=Path, default=ROOT / "results" / "gap_analysis.json")
    parser.add_argument("--missing-output", type=Path, default=ROOT / "out" / "missing_nearest.csv")
    arguments = parser.parse_args()

    enumerated = {
        row["place_id"]: (float(row["latitude"]), float(row["longitude"]))
        for row in csv.DictReader(arguments.enumerated.open(encoding="utf-8", newline=""))
    }
    probes = load_probes(arguments.cache)
    rule = RULES[arguments.rule]
    reached: set[str] = set()
    for seed in read_seeds(arguments.seeds):
        decision = rule(seed, probes.get(seed.seed_id, {}))
        if decision.status == STATUS_MATCHED and decision.place_id:
            reached.add(decision.place_id)
    missing = [place for place in enumerated if place not in reached]

    # コーパス全件を1パスなめて、取りこぼした place ごとの最寄り行を出す。
    wanted: dict[tuple[int, int], list[tuple[str, float, float]]] = defaultdict(list)
    for place in missing:
        latitude, longitude = enumerated[place]
        wanted[(int(latitude / CELL_DEGREES), int(longitude / CELL_DEGREES))].append(
            (place, latitude, longitude)
        )
    cells = {
        (i + di, j + dj) for (i, j) in wanted for di in (-1, 0, 1) for dj in (-1, 0, 1)
    }
    nearest: dict[str, tuple[float, str]] = defaultdict(lambda: (float("inf"), ""))
    with arguments.corpus.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                latitude, longitude = float(row["latitude"]), float(row["longitude"])
            except (TypeError, ValueError):
                continue
            key = (int(latitude / CELL_DEGREES), int(longitude / CELL_DEGREES))
            if key not in cells:
                continue
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for place, place_lat, place_lon in wanted.get((key[0] + di, key[1] + dj), ()):
                        distance = metres(latitude, longitude, place_lat, place_lon)
                        if distance < nearest[place][0]:
                            nearest[place] = (distance, row["name"])

    names = {
        row["google_place_id"]: row["name"]
        for row in csv.DictReader(arguments.restaurants.open(encoding="utf-8", newline=""))
    }

    distance_histogram: Counter = Counter()
    verdicts: Counter = Counter()
    rows = []
    for place in missing:
        distance, open_data_name = nearest[place]
        bucket = (
            "within_30m" if distance <= 30
            else "30_100m" if distance <= 100
            else "100_200m" if distance <= 200
            else "beyond_200m"
        )
        distance_histogram[bucket] += 1
        google_name = names.get(place, "")
        score = similarity(google_name, open_data_name) if google_name and open_data_name else None
        if score is not None:
            verdicts[
                "same_shop_matching_failure" if score >= SAME_SHOP_SIMILARITY
                else "similar" if score >= MAYBE_SIMILARITY
                else "different_shop_source_gap"
            ] += 1
        rows.append(
            {
                "place_id": place,
                "google_name": google_name,
                "nearest_m": round(distance, 1) if distance < float("inf") else "",
                "nearest_open_data_name": open_data_name,
                "name_similarity": round(score, 3) if score is not None else "",
            }
        )

    named = sum(1 for row in rows if row["google_name"])
    report = {
        "enumerated": len(enumerated),
        "reached": len(reached & set(enumerated)),
        "missing": len(missing),
        "reach_rate": round(len(reached & set(enumerated)) / len(enumerated), 6),
        "missing_distance_to_open_data": dict(distance_histogram),
        "distance_warning": (
            "区画は繁華街なので『近くに行がある』はほぼ常に成立する。距離だけで判断してはいけない"
        ),
        "named_missing": named,
        "name_verdicts": dict(verdicts),
        "name_verdict_shares": {
            key: round(value / named, 4) for key, value in verdicts.items()
        } if named else {},
    }
    arguments.missing_output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.missing_output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
