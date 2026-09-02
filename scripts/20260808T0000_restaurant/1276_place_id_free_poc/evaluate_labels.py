#!/usr/bin/env python3
"""正解ラベルに対して、判定ルールを層ごとに採点する。

負例による下限推定と違い、これは「この Overture 行の正解 place_id はこれ」という
実データの対応表に対して測るので、precision も recall も直接出る。

層ごとに分けて出すのが要点である。全体の精度が 99% でも、特定の層だけが
9割ということが実際に起きた。層別に見れば、落とすべき層と残すべき層が分かる。
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from free_places import SearchResult
from matching import PROBE_A, PROBE_B, PROBE_C, PROBE_C_WIDE, RULES, STATUS_MATCHED
from seeds import read_seeds

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
    """精度の95%信頼下限。少数の層で「0件だから100%」と誤読しないために出す。"""

    if total == 0:
        return 0.0
    z = 1.959964
    phat = successes / total
    denominator = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * ((phat * (1 - phat) + z * z / (4 * total)) / total) ** 0.5
    return max(0.0, (centre - margin) / denominator)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=ROOT / "out" / "labels.csv")
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rules", nargs="+", default=sorted(RULES))
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--mismatches-output",
        type=Path,
        help="ラベルと食い違った対を adjudicate.py に渡せる形で書き出す。--rules は1つに絞ること",
    )
    arguments = parser.parse_args()

    labels = {
        row["overture_id"]: row["true_google_place_id"]
        for row in csv.DictReader(arguments.labels.open(encoding="utf-8", newline=""))
    }
    probes = load_probes(arguments.cache)
    seeds = [seed for seed in read_seeds(arguments.seeds) if seed.seed_id in labels]

    # 正解が候補集合のどこかに現れている割合。どんな判定ルールでもこれは超えられない。
    ceiling = 0
    for seed in seeds:
        available: set[str] = set()
        for probe in (PROBE_A, PROBE_B, PROBE_C, PROBE_C_WIDE):
            result = probes.get(seed.seed_id, {}).get(probe)
            if result is not None and result.ok:
                available |= set(result.place_ids)
        if labels[seed.seed_id] in available:
            ceiling += 1

    report: dict[str, Any] = {
        "labelled_seeds": len(seeds),
        "recall_ceiling": round(ceiling / len(seeds), 6) if seeds else 0.0,
        "rules": {},
    }

    for rule_name in arguments.rules:
        rule = RULES[rule_name]
        correct = wrong = 0
        per_layer: dict[str, Counter] = defaultdict(Counter)
        mistakes: list[dict[str, str]] = []
        for seed in seeds:
            decision = rule(seed, probes.get(seed.seed_id, {}))
            if decision.status != STATUS_MATCHED:
                continue
            hit = decision.place_id == labels[seed.seed_id]
            correct += hit
            wrong += not hit
            per_layer[decision.detail]["matched"] += 1
            per_layer[decision.detail]["correct"] += hit
            if not hit:
                mistakes.append(
                    {
                        "overture_id": seed.seed_id,
                        "name": seed.name,
                        "layer": decision.detail,
                        "chosen": decision.place_id or "",
                        "truth": labels[seed.seed_id],
                    }
                )
        matched = correct + wrong
        report["rules"][rule_name] = {
            "matched": matched,
            "match_rate": round(matched / len(seeds), 6) if seeds else 0.0,
            "correct": correct,
            "wrong": wrong,
            "precision": round(correct / matched, 6) if matched else 0.0,
            "precision_95_lower": round(wilson_lower_bound(correct, matched), 6),
            "layers": {
                layer: {
                    "matched": counts["matched"],
                    "correct": counts["correct"],
                    "wrong": counts["matched"] - counts["correct"],
                    "precision": round(counts["correct"] / counts["matched"], 6),
                    "precision_95_lower": round(
                        wilson_lower_bound(counts["correct"], counts["matched"]), 6
                    ),
                }
                for layer, counts in sorted(per_layer.items())
            },
            # JSON は読むためのものなので切るが、裁定に回す全件は別に持つ。
            "mistakes": mistakes[:40],
            "all_mistakes": mistakes,
        }

    if arguments.mismatches_output:
        if len(arguments.rules) != 1:
            raise SystemExit("--mismatches-output は --rules を1つに絞ったときだけ書き出せる")
        rows = report["rules"][arguments.rules[0]]["all_mistakes"]
        arguments.mismatches_output.parent.mkdir(parents=True, exist_ok=True)
        with arguments.mismatches_output.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=["seed_id", "name", "layer", "mine", "theirs"])
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {
                        "seed_id": row["overture_id"],
                        "name": row["name"],
                        "layer": row["layer"],
                        "mine": row["chosen"],
                        "theirs": row["truth"],
                    }
                )

    for entry in report["rules"].values():
        entry.pop("all_mistakes", None)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
