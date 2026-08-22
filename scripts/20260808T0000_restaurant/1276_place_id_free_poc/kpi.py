#!/usr/bin/env python3
"""①②③ を1本のコマンドで出す。

分母が違う数字が混ざると読めなくなるので、ここで定義を固定する。

- ① 名寄せ確定率: **統合コーパス（3ソースを重複除去した 1,482,423 行）**から
  ハッシュで取った一様標本のうち、place_id が1つに確定した行の割合。
  Google に存在しない店も、座標が壊れている行も、すべて分母に入っている。
- ② 名寄せ正解率: 確定した行のうち、正解と一致した割合。正解は既存
  `public.restaurants`（bulk-import した Google 由来の10万件）との突合で作る。
  突合そのものが名寄せなので、**ラベルの質**で2通り出す。
    - 全ラベル: 距離・名前類似度を問わず作った対応表
    - 金ラベル: 距離 ≤20m かつ 名前類似度 ≥0.90 でだけ作った対応表
  不一致は `adjudicate.py` の機械裁定にかけ、`db_stale`（DB側が古い）と
  `duplicate`（同一店に place_id が2つ）は名寄せの誤りから除く。
- ③ Google 側の到達率: Nearby Search で敷き詰めて列挙した実在の Google
  レストラン **1,747 店**のうち、この名寄せがその place_id を実際に出力した割合。
  40m 以内にオープンデータ行が1件も無い 11 店も分母に残す。落とすと「そもそも
  seed が無いので取れない店」を分母から外すことになり、①で分母を絞ったのと
  同じ誤魔化しになる。
  （列挙そのものは課金対象だったため再実行しない。`REPORT.md` の記録を参照）
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
from matching import RULES, STATUS_MATCHED
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent

GOLD_MAX_DISTANCE_M = 20.0
GOLD_MIN_SIMILARITY = 0.90
NOT_OUR_ERROR = frozenset({"db_stale", "duplicate"})


def wilson(successes: int, total: int) -> tuple[float, float]:
    if total == 0:
        return 0.0, 0.0
    z = 1.959964
    phat = successes / total
    denominator = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * ((phat * (1 - phat) + z * z / (4 * total)) / total) ** 0.5
    return max(0.0, (centre - margin) / denominator), min(1.0, (centre + margin) / denominator)


def load_probes(path: Path) -> dict[str, dict[str, SearchResult]]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    probes: dict[str, dict[str, SearchResult]] = defaultdict(dict)
    for seed_id, probe, status, ids, error in connection.execute(
        "SELECT seed_id, probe, status, ids, error FROM probe"
    ):
        probes[seed_id][probe] = SearchResult(tuple(json.loads(ids)), status, error)
    connection.close()
    return probes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rule", default="box_unique_strict")
    parser.add_argument("--sample", type=Path, help="① 用の一様標本")
    parser.add_argument("--labels", type=Path, help="② 用の対応表")
    parser.add_argument("--label-seeds", type=Path, help="② 用の seed CSV")
    parser.add_argument("--adjudication", type=Path, help="② 用の裁定結果 CSV")
    parser.add_argument("--google-pairs", type=Path, help="③ 用の place_id -> seed_id")
    parser.add_argument("--google-seeds", type=Path, nargs="+", help="③ 用の seed CSV（複数可）")
    parser.add_argument("--output", type=Path, default=ROOT / "results" / "kpi.json")
    arguments = parser.parse_args()

    probes = load_probes(arguments.cache)
    rule = RULES[arguments.rule]
    report: dict[str, Any] = {"rule": arguments.rule}

    if arguments.sample:
        seeds = list(read_seeds(arguments.sample))
        detail: Counter = Counter()
        matched = 0
        for seed in seeds:
            decision = rule(seed, probes.get(seed.seed_id, {}))
            detail[decision.detail] += 1
            matched += decision.status == STATUS_MATCHED
        low, high = wilson(matched, len(seeds))
        report["kpi1_resolve_rate"] = {
            "denominator": len(seeds),
            "matched": matched,
            "rate": round(matched / len(seeds), 6),
            "ci95": [round(low, 6), round(high, 6)],
            "by_detail": dict(detail.most_common()),
        }

    if arguments.labels and arguments.label_seeds:
        labels = {
            row["overture_id"]: row
            for row in csv.DictReader(arguments.labels.open(encoding="utf-8", newline=""))
        }
        verdicts: dict[str, str] = {}
        if arguments.adjudication and arguments.adjudication.exists():
            verdicts = {
                row["seed_id"]: row["verdict"]
                for row in csv.DictReader(
                    arguments.adjudication.open(encoding="utf-8", newline="")
                )
            }
        seeds = [
            seed for seed in read_seeds(arguments.label_seeds) if seed.seed_id in labels
        ]
        buckets = {
            "all_labels": lambda row: True,
            "gold_labels": lambda row: (
                float(row["distance_m"]) <= GOLD_MAX_DISTANCE_M
                and float(row["name_similarity"]) >= GOLD_MIN_SIMILARITY
            ),
        }
        report["kpi2_precision"] = {}
        for name, keep in buckets.items():
            subset = [seed for seed in seeds if keep(labels[seed.seed_id])]
            matched = raw = errors = 0
            disagreements = []
            for seed in subset:
                decision = rule(seed, probes.get(seed.seed_id, {}))
                if decision.status != STATUS_MATCHED:
                    continue
                matched += 1
                if decision.place_id == labels[seed.seed_id]["true_google_place_id"]:
                    continue
                raw += 1
                verdict = verdicts.get(seed.seed_id, "未裁定")
                if verdict not in NOT_OUR_ERROR:
                    errors += 1
                disagreements.append(
                    {
                        "seed_id": seed.seed_id,
                        "name": seed.name,
                        "layer": decision.detail,
                        "verdict": verdict,
                        "label_distance_m": float(labels[seed.seed_id]["distance_m"]),
                        "label_similarity": float(labels[seed.seed_id]["name_similarity"]),
                    }
                )
            low, _ = wilson(matched - errors, matched)
            report["kpi2_precision"][name] = {
                "labels": len(subset),
                "matched": matched,
                "raw_disagreements": raw,
                "errors_after_adjudication": errors,
                "precision": round((matched - errors) / matched, 6) if matched else 0.0,
                "precision_95_lower": round(low, 6),
                "disagreements": disagreements[:40],
            }

    if arguments.google_pairs and arguments.google_seeds:
        pairs = json.loads(arguments.google_pairs.read_text())
        resolved: dict[str, str] = {}
        for path in arguments.google_seeds:
            for seed in read_seeds(path):
                decision = rule(seed, probes.get(seed.seed_id, {}))
                if decision.status == STATUS_MATCHED and decision.place_id:
                    resolved[seed.seed_id] = decision.place_id
        # pairs は「その place の近くにある seed」の表だが、追加ソースは pairs に
        # 載っていない。place_id が一致した seed があればどれでも到達とみなす。
        hit = set(resolved.values())
        reached = sum(1 for place_id in pairs if place_id in hit)
        low, high = wilson(reached, len(pairs))
        report["kpi3_google_reach"] = {
            "enumerated_google_places": len(pairs),
            "reached": reached,
            "rate": round(reached / len(pairs), 6) if pairs else 0.0,
            "ci95": [round(low, 6), round(high, 6)],
            "seeds_involved": len(resolved),
        }

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
