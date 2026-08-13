#!/usr/bin/env python3
"""正解ラベルつき seed で、判定に使える「証拠の組み合わせ」を総当たりで採点する。

これまでは層（layer1, v2_common_in_box …）を手で足しては測る、という進め方を
していた。層の順序と条件を人が決めているので、precision の低い層を後から見つけて
外す、という後戻りが起きる。ここでは逆にする。

1. 候補を1つ選ぶ（複数の選び方を試す）
2. その候補について、キャッシュ済み probe から真偽値の特徴を作る
3. 特徴の連言（ゲート）を総当たりで作り、ラベルに対する precision / recall を測る
4. precision の95%信頼下限がしきい値以上のゲートだけを、recall の大きい順に採る

②（正解率）は妥協できないので、precision は点推定ではなく信頼下限で見る。
標本が小さい層が「3件中3件だから100%」で紛れ込むのを防ぐためである。
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from free_places import SearchResult
from matching import PROBE_A, PROBE_B, PROBE_C, PROBE_C_TIGHT, PROBE_C_WIDE
from seeds import Seed, read_seeds

ROOT = Path(__file__).resolve().parent


def load_probes(path: Path) -> dict[str, dict[str, SearchResult]]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    probes: dict[str, dict[str, SearchResult]] = defaultdict(dict)
    for seed_id, probe, status, ids, error in connection.execute(
        "SELECT seed_id, probe, status, ids, error FROM probe"
    ):
        probes[seed_id][probe] = SearchResult(tuple(json.loads(ids)), status, error)
    connection.close()
    return probes


def wilson_lower_bound(successes: int, total: int) -> float:
    if total == 0:
        return 0.0
    z = 1.959964
    phat = successes / total
    denominator = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * ((phat * (1 - phat) + z * z / (4 * total)) / total) ** 0.5
    return max(0.0, (centre - margin) / denominator)


def ids(probes: Mapping[str, SearchResult], probe: str) -> tuple[str, ...]:
    result = probes.get(probe)
    return result.place_ids if result is not None and result.ok else ()


@dataclass(frozen=True)
class Evidence:
    """1つの seed について、候補と、その候補を支持する証拠。"""

    seed_id: str
    candidate: str | None
    origin: str
    features: frozenset[str]


def build_evidence(seed: Seed, probes: Mapping[str, SearchResult]) -> Evidence:
    a, b = ids(probes, PROBE_A), ids(probes, PROBE_B)
    c, tight, wide = ids(probes, PROBE_C), ids(probes, PROBE_C_TIGHT), ids(probes, PROBE_C_WIDE)
    set_a, set_b, set_c, set_t, set_w = set(a), set(b), set(c), set(tight), set(wide)

    # 候補の選び方。狭い矩形で一意に決まるものを最優先し、次に A∩B を見る。
    # ここで選ばれなかった seed は「候補なし」として recall の分母に残る。
    candidate, origin = None, "none"
    intersection = set_a & set_b
    if len(set_t) == 1 and (set_t & (set_a | set_b)):
        candidate, origin = next(iter(set_t)), "tight_unique"
    elif len(intersection & set_c) == 1:
        candidate, origin = next(iter(intersection & set_c)), "ab_in_box"
    elif len(intersection) == 1:
        candidate, origin = next(iter(intersection)), "ab_only"
    elif a and b and a[0] == b[0]:
        candidate, origin = a[0], "ab_top1"
    elif len(set_b & set_c) == 1:
        candidate, origin = next(iter(set_b & set_c)), "b_in_box"
    elif len(set_a & set_c) == 1:
        candidate, origin = next(iter(set_a & set_c)), "a_in_box"
    elif len(intersection & set_w) == 1:
        candidate, origin = next(iter(intersection & set_w)), "ab_in_wide_box"
    elif len(set_c) == 1 and set_c & (set_a | set_b):
        candidate, origin = next(iter(set_c)), "box_unique"

    if candidate is None:
        return Evidence(seed.seed_id, None, "none", frozenset())

    features = set()
    for label, collection in (("a", set_a), ("b", set_b), ("c", set_c), ("t", set_t), ("w", set_w)):
        if candidate in collection:
            features.add(f"in_{label}")
    if a and a[0] == candidate:
        features.add("top1_a")
    if b and b[0] == candidate:
        features.add("top1_b")
    if a and b and a[0] == b[0] == candidate:
        features.add("top1_ab")
    for label, collection in (("c", set_c), ("t", set_t), ("w", set_w), ("a", set_a), ("b", set_b)):
        if len(collection) == 1:
            features.add(f"only1_{label}")
    if len(set_a & set_b) == 1:
        features.add("ab_singleton")
    if not set_t:
        features.add("empty_t")
    if seed.address_quality != "none":
        features.add("has_address")
    return Evidence(seed.seed_id, candidate, origin, frozenset(features))


# ゲートに使う特徴。多すぎると組み合わせが爆発するので、意味のあるものに絞る。
FEATURES = (
    "in_a", "in_b", "in_c", "in_t", "in_w",
    "top1_a", "top1_b", "top1_ab",
    "only1_c", "only1_t", "ab_singleton", "has_address",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--max-terms", type=int, default=3)
    parser.add_argument("--min-support", type=int, default=25)
    parser.add_argument("--min-precision-lower", type=float, default=0.99)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    truth: dict[str, str] = {}
    with arguments.labels.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            truth[row["overture_id"]] = row["true_google_place_id"]

    probes = load_probes(arguments.cache)
    evidence: list[tuple[Evidence, bool]] = []
    labelled = 0
    for seed in read_seeds(arguments.seeds):
        expected = truth.get(seed.seed_id)
        if expected is None:
            continue
        labelled += 1
        item = build_evidence(seed, probes.get(seed.seed_id, {}))
        evidence.append((item, item.candidate == expected))

    have_candidate = [pair for pair in evidence if pair[0].candidate is not None]
    report: dict[str, Any] = {
        "labelled_seeds": labelled,
        "with_candidate": len(have_candidate),
        "candidate_correct": sum(1 for _, correct in have_candidate if correct),
        "by_origin": {},
        "gates": [],
    }
    by_origin: dict[str, list[bool]] = defaultdict(list)
    for item, correct in have_candidate:
        by_origin[item.origin].append(correct)
    report["by_origin"] = {
        origin: {
            "n": len(values),
            "correct": sum(values),
            "precision": round(sum(values) / len(values), 4),
            "precision_lower": round(wilson_lower_bound(sum(values), len(values)), 4),
        }
        for origin, values in sorted(by_origin.items(), key=lambda pair: -len(pair[1]))
    }

    # 特徴の連言を総当たりする。origin も1つの特徴として混ぜる。
    origins = sorted(by_origin)
    gates: list[dict[str, Any]] = []
    for size in range(1, arguments.max_terms + 1):
        for combination in itertools.combinations(FEATURES, size):
            required = frozenset(combination)
            for origin in [None, *origins]:
                selected = [
                    correct
                    for item, correct in have_candidate
                    if required <= item.features and (origin is None or item.origin == origin)
                ]
                if len(selected) < arguments.min_support:
                    continue
                lower = wilson_lower_bound(sum(selected), len(selected))
                if lower < arguments.min_precision_lower:
                    continue
                gates.append(
                    {
                        "features": sorted(required),
                        "origin": origin,
                        "n": len(selected),
                        "correct": sum(selected),
                        "precision": round(sum(selected) / len(selected), 5),
                        "precision_lower": round(lower, 5),
                    }
                )
    gates.sort(key=lambda gate: (-gate["n"], -gate["precision_lower"]))
    report["gates"] = gates[:60]
    report["gate_count"] = len(gates)

    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
