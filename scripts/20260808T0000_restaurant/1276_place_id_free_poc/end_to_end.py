#!/usr/bin/env python3
"""既存 `public.restaurants` のうち、名寄せ後に place_id で引き当てられる割合を出す。

「Overture が Google Places の何割を持っているか」ではなく、
**「Google Maps からオープンデータへ移行したとき、既存の店が何割残るか」** を測る。
移行可否の判断材料はこちらである。

内訳は3段階に分かれる。

1. not_in_overture   : そもそも Overture に対応行が無い。名寄せ以前の問題。
2. not_matched       : Overture には在るが、名寄せで place_id を確定できなかった。
3. matched_wrong     : 確定したが、既存DBの place_id と違うものを引いた。
4. matched_correct   : 確定して、既存DBの place_id と一致した。← これが移行後も残る店

4 の割合が、そのまま「移行後に既存DBの何割を維持できるか」になる。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from free_places import SearchResult
from ground_truth import haversine_m, load_restaurants
from jp_text import name_similarity
from matching import RULES, STATUS_MATCHED
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    parser.add_argument("--seeds", type=Path, required=True, help="名寄せを実行した seed CSV")
    parser.add_argument("--all-seeds", type=Path, required=True, help="Overture 全件の seed CSV")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rule", default="layered_v2")
    parser.add_argument("--radius-m", type=float, default=100.0)
    parser.add_argument("--min-name-similarity", type=float, default=0.6)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    restaurants, restaurant_stats = load_restaurants(arguments.restaurants)

    # Overture 全件で「その restaurant に対応する行があるか」を判定する。
    cell = arguments.radius_m / 111_320.0
    grid: dict[tuple[int, int], list] = {}
    for seed in read_seeds(arguments.all_seeds):
        grid.setdefault((int(seed.latitude / cell), int(seed.longitude / cell)), []).append(seed)

    # 名寄せを実行した seed の判定結果。
    connection = sqlite3.connect(f"file:{arguments.cache}?mode=ro", uri=True)
    probes: dict[str, dict[str, SearchResult]] = defaultdict(dict)
    for seed_id, probe, status, ids, error in connection.execute(
        "SELECT seed_id, probe, status, ids, error FROM probe"
    ):
        probes[seed_id][probe] = SearchResult(tuple(json.loads(ids)), status, error)
    connection.close()

    rule = RULES[arguments.rule]
    resolved: dict[str, str] = {}
    probed: set[str] = set()
    for seed in read_seeds(arguments.seeds):
        probed.add(seed.seed_id)
        decision = rule(seed, probes.get(seed.seed_id, {}))
        if decision.status == STATUS_MATCHED and decision.place_id:
            resolved[seed.seed_id] = decision.place_id

    verdicts: Counter = Counter()
    for truth in restaurants.values():
        base = (int(truth.latitude / cell), int(truth.longitude / cell))
        counterpart = None
        best = 0.0
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for seed in grid.get((base[0] + d_lat, base[1] + d_lon), []):
                    if haversine_m(seed.latitude, seed.longitude, truth.latitude, truth.longitude) > arguments.radius_m:
                        continue
                    similarity = name_similarity(seed.name, truth.name)
                    if similarity > best:
                        best, counterpart = similarity, seed
        if counterpart is None or best < arguments.min_name_similarity:
            verdicts["not_in_overture"] += 1
            continue
        if counterpart.seed_id not in probed:
            # 名寄せを走らせていない行。標本での推定にはこれを分母から外す。
            verdicts["not_probed"] += 1
            continue
        chosen = resolved.get(counterpart.seed_id)
        if chosen is None:
            verdicts["not_matched"] += 1
        elif chosen == truth.google_place_id:
            verdicts["matched_correct"] += 1
        else:
            verdicts["matched_wrong"] += 1

    evaluable = sum(
        verdicts[key] for key in ("not_in_overture", "not_matched", "matched_correct", "matched_wrong")
    )
    in_scope = verdicts["not_matched"] + verdicts["matched_correct"] + verdicts["matched_wrong"]
    report = {
        "restaurants": restaurant_stats,
        "rule": arguments.rule,
        "verdicts": dict(verdicts),
        "evaluable": evaluable,
        # 名寄せを走らせた範囲に限った、移行後に維持できる割合。
        "retained_rate_in_probed_scope": (
            round(verdicts["matched_correct"] / in_scope, 6) if in_scope else 0.0
        ),
        # Overture に載っていない分も含めた、全体としての維持率。
        "retained_rate_overall": (
            round(verdicts["matched_correct"] / evaluable, 6) if evaluable else 0.0
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
