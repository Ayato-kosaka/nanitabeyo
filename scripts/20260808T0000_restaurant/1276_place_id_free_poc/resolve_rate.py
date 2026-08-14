#!/usr/bin/env python3
"""①（名寄せ確定率）を、分母の定義を並べて出す。

「何割を確定できたか」は分母の取り方で大きく動く。オープンデータには、閉店した店、
Google に載っていない店、そもそも店ではない行が混ざっている。それらを分母に入れた
数字と、除いた数字は別のことを言っている。片方だけを出すと読み手が誤解するので、
定義を先に決めて全部出す。

- all              : seed 全件。オープンデータをそのまま使ったときの率
- text_hit         : 店名クエリ(A または B)が何か返した行
- in_wide_box      : ±250m の矩形に同名の place が1件以上ある行
- in_box           : ±75m の矩形に同名の place が1件以上ある行
- in_tight_box     : ±25m の矩形に同名の place が1件以上ある行

矩形の locationRestriction は矩形外を実際に切り落とすので、「±250m の矩形に
同名が1件も無い」は「Google にその店がその座標の近くには無い」を意味する。
したがって in_wide_box が「Google に存在しうる行」の素直な定義になる。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from free_places import SearchResult
from matching import (
    PROBE_A,
    PROBE_B,
    PROBE_C,
    PROBE_C_TIGHT,
    PROBE_C_WIDE,
    RULES,
    STATUS_MATCHED,
)
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent

DENOMINATORS = ("all", "text_hit", "in_wide_box", "in_box", "in_tight_box")


def load_probes(path: Path) -> dict[str, dict[str, SearchResult]]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    probes: dict[str, dict[str, SearchResult]] = defaultdict(dict)
    for seed_id, probe, status, ids, error in connection.execute(
        "SELECT seed_id, probe, status, ids, error FROM probe"
    ):
        probes[seed_id][probe] = SearchResult(tuple(json.loads(ids)), status, error)
    connection.close()
    return probes


def ids(probes: dict[str, SearchResult], probe: str) -> tuple[str, ...]:
    result = probes.get(probe)
    return result.place_ids if result is not None and result.ok else ()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, nargs="+", required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rule", default="box_unique")
    parser.add_argument("--by-source", action="store_true", help="seed_id の接頭辞ごとにも出す")
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    probes = load_probes(arguments.cache)
    rule = RULES[arguments.rule]

    totals: Counter = Counter()
    matched: Counter = Counter()
    details: Counter = Counter()
    per_source: dict[str, tuple[Counter, Counter]] = defaultdict(lambda: (Counter(), Counter()))
    skipped_unprobed = 0

    for path in arguments.seeds:
        for seed in read_seeds(path):
            probe = probes.get(seed.seed_id)
            # 遅延取得では矩形だけ送って終わる seed がある。A の有無では判定しない。
            if not probe or (PROBE_C_TIGHT not in probe and PROBE_A not in probe):
                skipped_unprobed += 1
                continue
            a, b = ids(probe, PROBE_A), ids(probe, PROBE_B)
            memberships = {
                "all": True,
                "text_hit": bool(a or b),
                "in_wide_box": bool(ids(probe, PROBE_C_WIDE) or ids(probe, PROBE_C)),
                "in_box": bool(ids(probe, PROBE_C)),
                "in_tight_box": bool(ids(probe, PROBE_C_TIGHT)),
            }
            decision = rule(seed, probe)
            is_match = decision.status == STATUS_MATCHED
            details[decision.detail] += 1
            source = "ifas" if seed.seed_id.startswith("ifas:") else (
                "osm" if seed.seed_id.startswith("osm:") else "overture"
            )
            for name, member in memberships.items():
                if not member:
                    continue
                totals[name] += 1
                per_source[source][0][name] += 1
                if is_match:
                    matched[name] += 1
                    per_source[source][1][name] += 1

    def rates(total: Counter, hit: Counter) -> dict[str, Any]:
        return {
            name: {
                "denominator": total[name],
                "matched": hit[name],
                "rate": round(hit[name] / total[name], 6) if total[name] else 0.0,
            }
            for name in DENOMINATORS
        }

    report: dict[str, Any] = {
        "rule": arguments.rule,
        "skipped_unprobed": skipped_unprobed,
        "resolve_rate": rates(totals, matched),
        "decision_detail": dict(details.most_common()),
    }
    if arguments.by_source:
        report["by_source"] = {
            source: rates(total, hit) for source, (total, hit) in sorted(per_source.items())
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
