#!/usr/bin/env python3
"""追加ソースを足したとき、主KPI（Google 側の到達率）が何ポイント上がるかを測る。

測り方はこうする。

1. Nearby で列挙済みの Google の店（`results/google_coverage_db.csv`）を分母にする
2. 追加ソースのうち、列挙済みの店の近くにある行だけを取り出す（全国を probe しても
   区画の外の店には効かないので、リクエストを無駄にしない）
3. その行を probe して、列挙済みの店に当たるかを見る
4. 追加前と追加後で到達率を比べる

自治体で切って見られるようにしてある。台帳は自治体ごとに公開状況が違うので、
「鹿児島市の台帳を足したら鹿児島市の区画で何ポイント上がったか」を見ないと、
全国に広げたときの効果が読めない。
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
from matching import RULES, STATUS_MATCHED
from seeds import read_seeds

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

CELL_DEGREES = 0.004


def read_seeds_lenient(path: Path):
    """座標が空の行を飛ばして seed を読む。"""

    import tempfile

    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [row for row in reader if row.get("latitude") and row.get("longitude")]
        fields = reader.fieldnames or []
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", suffix=".csv",
                                     delete=False) as sink:
        writer = csv.DictWriter(sink, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        temporary = Path(sink.name)
    try:
        yield from read_seeds(temporary)
    finally:
        temporary.unlink(missing_ok=True)


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
    parser.add_argument("--enumerated", type=Path,
                        default=ROOT / "results" / "google_coverage_db.csv")
    parser.add_argument("--base-seeds", type=Path, nargs="+", required=True,
                        help="いま使っている3ソース側の seed")
    parser.add_argument("--extra-seeds", type=Path, nargs="*", default=[],
                        help="追加ソースの seed")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--rule", default="box_unique")
    parser.add_argument("--radius-m", type=float, default=200.0)
    parser.add_argument("--select-output", type=Path,
                        help="追加ソースのうち probe すべき行を書き出す")
    parser.add_argument("--output", type=Path, default=ROOT / "results" / "kpi3_gain.json")
    arguments = parser.parse_args()

    enumerated = {
        row["place_id"]: (float(row["latitude"]), float(row["longitude"]))
        for row in csv.DictReader(arguments.enumerated.open(encoding="utf-8", newline=""))
    }
    grid: dict[tuple[int, int], list[tuple[str, float, float]]] = defaultdict(list)
    for place, (latitude, longitude) in enumerated.items():
        grid[(int(latitude / CELL_DEGREES), int(longitude / CELL_DEGREES))].append(
            (place, latitude, longitude)
        )

    def near(latitude: float, longitude: float) -> bool:
        base = (int(latitude / CELL_DEGREES), int(longitude / CELL_DEGREES))
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                for _, place_lat, place_lon in grid.get((base[0] + d_lat, base[1] + d_lon), ()):
                    distance = math.hypot(
                        (latitude - place_lat) * 111_320.0,
                        (longitude - place_lon) * 111_320.0
                        * math.cos(math.radians(latitude)),
                    )
                    if distance <= arguments.radius_m:
                        return True
        return False

    probes = load_probes(arguments.cache)
    rule = RULES[arguments.rule]

    def resolve(paths: list[Path]) -> tuple[set[str], int, int]:
        hit: set[str] = set()
        probed = matched = 0
        for path in paths:
            # 追加ソースには座標がまだ付いていない行が混ざる。read_seeds は座標を
            # float で読むので、先に落としてから渡す。
            for seed in read_seeds_lenient(path):
                if seed.seed_id not in probes:
                    continue
                probed += 1
                decision = rule(seed, probes.get(seed.seed_id, {}))
                if decision.status == STATUS_MATCHED and decision.place_id:
                    matched += 1
                    hit.add(decision.place_id)
        return hit, probed, matched

    base_hit, base_probed, base_matched = resolve(list(arguments.base_seeds))
    extra_hit, extra_probed, extra_matched = resolve(list(arguments.extra_seeds))

    # 追加ソースのうち、まだ probe していない・区画の近くにある行を書き出す。
    selected: list[dict] = []
    if arguments.select_output and arguments.extra_seeds:
        fields = None
        for path in arguments.extra_seeds:
            with path.open(encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                fields = reader.fieldnames
                for row in reader:
                    if row["seed_id"] in probes:
                        continue
                    try:
                        latitude, longitude = float(row["latitude"]), float(row["longitude"])
                    except (TypeError, ValueError):
                        continue
                    if near(latitude, longitude):
                        selected.append(row)
        if fields:
            arguments.select_output.parent.mkdir(parents=True, exist_ok=True)
            with arguments.select_output.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(selected)

    total = len(enumerated)
    both = base_hit | extra_hit
    report = {
        "enumerated": total,
        "base": {
            "seeds_probed": base_probed,
            "seeds_matched": base_matched,
            "reached": len(base_hit & set(enumerated)),
            "rate": round(len(base_hit & set(enumerated)) / total, 6),
        },
        "with_extra": {
            "seeds_probed": extra_probed,
            "seeds_matched": extra_matched,
            "reached": len(both & set(enumerated)),
            "rate": round(len(both & set(enumerated)) / total, 6),
        },
        "gain_points": round(
            (len(both & set(enumerated)) - len(base_hit & set(enumerated))) / total * 100, 3
        ),
        "extra_only_reached": len((extra_hit - base_hit) & set(enumerated)),
        "selected_for_probing": len(selected),
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
