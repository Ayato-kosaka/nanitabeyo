#!/usr/bin/env python3
"""既存 `public.restaurants` を正解データとして、名寄せ結果の正しさを測る。

これは #1276 の受け入れ条件「正解検証 99% 以上」を判定する唯一のスクリプトである。
`verify_join.py` が距離分布を出すのに対し、こちらは **合否を出す**。

判定の考え方:
- join は `google_place_id`。既存DBの place_id は Google 由来なので、これが正解。
- 「大きくズレている」を、座標と店名の両方で見る。座標だけだと、同じビルに入った
  別の店を掴んでいても近いので通ってしまう。店名だけだと、Overture と Google で
  表記が違うだけの同一店舗を落としてしまう。
- ただし店名は表記ゆれが大きいので、閾値は緩めに置き、代わりに落ちた行を全部
  書き出して目視できるようにしている。

`labels` サブコマンドは、既存DBから逆に「この Overture 行の正解 place_id はこれ」
という対応表を作る。負例による下限推定ではなく、実データでの precision / recall を
直接測るために使う（Issue #1261 の Step 2 較正に相当）。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from jp_text import name_similarity, normalize_for_comparison, scripts_differ
from seeds import read_seeds

EARTH_RADIUS_M = 6_371_000.0
ROOT = Path(__file__).resolve().parent

# 既存DBの座標は Google 由来、CSV側は Overture 由来。同一店舗でも数十mはずれる。
# owner 実測では join できた1,031件の p99 が 160m だったため、200m を上限に置く。
DEFAULT_MAX_DISTANCE_M = 200.0
# 表記ゆれを許すため低め。これを下回っても座標が至近なら救済する。
DEFAULT_MIN_NAME_SIMILARITY = 0.34
# この距離以内なら、店名が全く違って見えても同一店舗として扱う（同居店舗・改称）。
DEFAULT_NAME_WAIVER_DISTANCE_M = 30.0
# 同じ名前を持つ行がこの数以上あれば、その名前はチェーン名とみなす。
DEFAULT_CHAIN_THRESHOLD = 5
# チェーン行の合格条件。店名は支店を区別しないので、距離だけで判定する。
CHAIN_MAX_DISTANCE_M = 75.0
# 表記体系が違って店名を比較できない行の合格条件。名前が使えない分、距離を締める。
CROSS_SCRIPT_MAX_DISTANCE_M = 60.0
# 固有性の高い店名がほぼ完全に一致する場合の閾値と、その場合に許す距離。
# 同名の行が少ない店名が 500m 以内に二つ存在することはまず無いので、
# 名前が一致していれば Overture 側の座標ズレとみなせる。
STRONG_NAME_SIMILARITY = 0.85
STRONG_NAME_MAX_DISTANCE_M = 500.0


def chain_key(name: str) -> str:
    """同名判定に使うキー。

    支店名まで落として「マクドナルド渋谷店」と「マクドナルド」を同じ束にはしない。
    支店名が付いている行は名前そのものが支店を特定しており、判定を厳しくする必要が
    無いからである。危ないのは店名がチェーン名のままの行（Overture には「マクドナルド」
    という名前だけの行が 2,741件ある）で、それは同名多数として自然に検出される。
    """

    return normalize_for_comparison(name)


def build_chain_frequency(seeds_paths: Iterable[Path]) -> Counter:
    """コーパス全体で、支店名を除いた店名がいくつあるかを数える。

    チェーン店は店名だけでは支店を区別できない。実測では Overture 日本の飲食店の
    21.7% が他の行と同名で、「マクドナルド」だけで 2,741行ある。こういう行は
    「名前が似ている」ことが正しさの証拠にならないので、判定条件を変える必要がある。
    """

    frequency: Counter = Counter()
    for path in seeds_paths:
        for seed in read_seeds(path):
            frequency[chain_key(seed.name)] += 1
    return frequency


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, a)))


@dataclass(frozen=True)
class Restaurant:
    restaurant_id: str
    name: str
    latitude: float
    longitude: float
    google_place_id: str


def load_restaurants(path: Path) -> tuple[dict[str, Restaurant], dict[str, Any]]:
    """restaurants CSV を place_id 索引で読む。

    同じ place_id が複数行にあるのは既存DB側の重複なので、最初の1行を採用しつつ
    件数を報告する。列名が違う環境もあるため、必要な列が無ければ明示的に落とす。
    """

    by_place_id: dict[str, Restaurant] = {}
    duplicates = 0
    total = 0
    missing_place_id = 0
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"id", "name", "latitude", "longitude", "google_place_id"}
        missing_columns = required - set(reader.fieldnames or [])
        if missing_columns:
            raise SystemExit(
                f"restaurants CSV に必要な列がない: {sorted(missing_columns)} / 実際: {reader.fieldnames}"
            )
        for row in reader:
            total += 1
            place_id = (row.get("google_place_id") or "").strip()
            if not place_id:
                missing_place_id += 1
                continue
            if place_id in by_place_id:
                duplicates += 1
                continue
            try:
                latitude = float(row["latitude"])
                longitude = float(row["longitude"])
            except (TypeError, ValueError):
                continue
            by_place_id[place_id] = Restaurant(
                restaurant_id=row["id"],
                name=row.get("name") or "",
                latitude=latitude,
                longitude=longitude,
                google_place_id=place_id,
            )
    stats = {
        "rows": total,
        "with_google_place_id": total - missing_place_id,
        "without_google_place_id": missing_place_id,
        "duplicate_place_ids": duplicates,
        "distinct_place_ids": len(by_place_id),
    }
    return by_place_id, stats


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(fraction * (len(ordered) - 1)))))
    return ordered[index]


def command_verify(arguments: argparse.Namespace) -> None:
    restaurants, restaurant_stats = load_restaurants(arguments.restaurants)
    rows = list(csv.DictReader(arguments.matched.open(encoding="utf-8", newline="")))
    frequency = build_chain_frequency(arguments.seeds) if arguments.seeds else Counter()

    judged: list[dict[str, Any]] = []
    for row in rows:
        truth = restaurants.get(row["google_place_id"])
        if truth is None:
            continue
        distance = haversine_m(
            float(row["latitude"]), float(row["longitude"]), truth.latitude, truth.longitude
        )
        similarity = name_similarity(row["name"], truth.name)
        siblings = frequency.get(chain_key(row["name"]), 1)
        is_chain = siblings >= arguments.chain_threshold
        cross_script = scripts_differ(row["name"], truth.name)
        if is_chain:
            # チェーンは店名が支店を区別しない。「吉野家」という名前の Overture 行と
            # 「吉野家 １号線富洲原店」は距離4mで同一店だが、文字列は一致しない。
            # 逆に隣の支店を掴む誤りは距離に現れる（同名の最近傍が200m以内にある行は
            # 実測で 0.46%）。したがってチェーンは距離だけで判定する。
            distance_ok = distance <= CHAIN_MAX_DISTANCE_M
            name_ok = True
            rule = "chain_distance_only"
        elif similarity >= STRONG_NAME_SIMILARITY:
            # 「フィエスタ」と「フィエスタ」が 238m 離れている等。固有な店名が
            # 一致している以上、離れているのは Overture の座標が粗いからである。
            distance_ok = distance <= STRONG_NAME_MAX_DISTANCE_M
            name_ok = True
            rule = "strong_name"
        elif cross_script:
            # 「Torikizoku」と「鳥貴族 越谷店」のように表記体系が違う組み合わせでは、
            # 文字列の不一致は別店である証拠にならない。名前を使わず距離を締める。
            distance_ok = distance <= CROSS_SCRIPT_MAX_DISTANCE_M
            name_ok = True
            rule = "cross_script_distance_only"
        else:
            distance_ok = distance <= arguments.max_distance_m
            name_ok = (
                similarity >= arguments.min_name_similarity
                or distance <= arguments.name_waiver_distance_m
            )
            rule = "name_and_distance"
        judged.append(
            {
                "overture_id": row["overture_id"],
                "google_place_id": row["google_place_id"],
                "confidence_tier": row.get("confidence_tier", ""),
                "match_detail": row.get("match_detail", ""),
                "overture_name": row["name"],
                "restaurant_name": truth.name,
                "restaurant_id": truth.restaurant_id,
                "distance_m": round(distance, 1),
                "name_similarity": round(similarity, 3),
                "same_name_siblings": siblings,
                "is_chain": is_chain,
                "rule": rule,
                "verdict": "pass" if (distance_ok and name_ok) else "fail",
                "fail_reason": (
                    "" if (distance_ok and name_ok)
                    else ("distance" if not distance_ok else "name")
                ),
            }
        )

    passed = [entry for entry in judged if entry["verdict"] == "pass"]
    distances = [entry["distance_m"] for entry in judged]
    by_tier: dict[str, dict[str, int]] = {}
    for entry in judged:
        bucket = by_tier.setdefault(entry["confidence_tier"], {"joined": 0, "pass": 0})
        bucket["joined"] += 1
        bucket["pass"] += entry["verdict"] == "pass"

    summary = {
        "matched_rows": len(rows),
        "restaurants": restaurant_stats,
        "joined": len(judged),
        "join_rate": round(len(judged) / len(rows), 6) if rows else 0.0,
        "passed": len(passed),
        "accuracy": round(len(passed) / len(judged), 6) if judged else 0.0,
        "failed": len(judged) - len(passed),
        "fail_reasons": dict(Counter(e["fail_reason"] for e in judged if e["fail_reason"])),
        "distance_m": {
            "p50": percentile(distances, 0.50),
            "p90": percentile(distances, 0.90),
            "p99": percentile(distances, 0.99),
            "max": max(distances) if distances else 0.0,
        },
        "by_tier": {
            tier: {
                **counts,
                "accuracy": round(counts["pass"] / counts["joined"], 6) if counts["joined"] else 0.0,
            }
            for tier, counts in sorted(by_tier.items())
        },
        "by_match_detail": {
            detail: {
                "joined": total,
                "pass": sum(
                    1 for e in judged if e["match_detail"] == detail and e["verdict"] == "pass"
                ),
            }
            for detail, total in Counter(e["match_detail"] for e in judged).items()
        },
        "by_rule": {
            name: {
                "judged": sum(1 for e in judged if e["rule"] == name),
                "pass": sum(1 for e in judged if e["rule"] == name and e["verdict"] == "pass"),
            }
            for name in sorted({e["rule"] for e in judged})
        },
        "thresholds": {
            "max_distance_m": arguments.max_distance_m,
            "min_name_similarity": arguments.min_name_similarity,
            "name_waiver_distance_m": arguments.name_waiver_distance_m,
            "chain_threshold": arguments.chain_threshold,
            "chain_max_distance_m": CHAIN_MAX_DISTANCE_M,
            "cross_script_max_distance_m": CROSS_SCRIPT_MAX_DISTANCE_M,
            "chain_frequency_source": [str(path) for path in (arguments.seeds or [])],
        },
        # この正解率は「既存DBに載っている place_id」に限った値である。既存DBは
        # ユーザーが実際に検索した実績のある店なので、Google 側の情報が充実した
        # 簡単な母集団に偏る。出力CSV全体やOverture全体の正しさには外挿できない。
        "caveat": (
            "accuracy は google_place_id が既存DBに存在した行のみで計算しており、"
            "既存DBに無い行の正しさは測れていない"
        ),
    }

    if arguments.detail_output:
        arguments.detail_output.parent.mkdir(parents=True, exist_ok=True)
        with arguments.detail_output.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(judged[0].keys()) if judged else ["overture_id"])
            writer.writeheader()
            writer.writerows(sorted(judged, key=lambda e: -e["distance_m"]))
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    failures = [entry for entry in judged if entry["verdict"] == "fail"]
    if failures:
        print("\n--- 不合格（距離降順・上位20） ---", file=sys.stderr)
        for entry in sorted(failures, key=lambda e: -e["distance_m"])[:20]:
            print(
                f"  {entry['distance_m']:8.1f}m sim={entry['name_similarity']:.2f}"
                f" [{entry['confidence_tier']}] {entry['overture_name']} ⇔ {entry['restaurant_name']}",
                file=sys.stderr,
            )


def command_labels(arguments: argparse.Namespace) -> None:
    """既存DBから「Overture 行 → 正解 place_id」の対応表を作る。

    既存DBの各店舗に対し、名称が十分似ていて距離が近い Overture 行が **ちょうど1つ**
    のときだけ採用する。複数該当したら、どれが正解か決められないので捨てる。
    ここで曖昧なものを混ぜると、以降の precision 測定そのものが濁る。
    """

    restaurants, restaurant_stats = load_restaurants(arguments.restaurants)
    seeds = list(read_seeds(arguments.seeds))

    # 粗いグリッドで近傍だけを比較する。全組み合わせは 10^5 x 10^4 で現実的でない。
    cell = arguments.radius_m / 111_320.0
    grid: dict[tuple[int, int], list[Any]] = {}
    for seed in seeds:
        key = (int(seed.latitude / cell), int(seed.longitude / cell))
        grid.setdefault(key, []).append(seed)

    labels: list[dict[str, Any]] = []
    ambiguous = 0
    for truth in restaurants.values():
        base = (int(truth.latitude / cell), int(truth.longitude / cell))
        candidates = []
        for d_lat in (-1, 0, 1):
            for d_lon in (-1, 0, 1):
                candidates.extend(grid.get((base[0] + d_lat, base[1] + d_lon), []))
        hits = []
        for seed in candidates:
            distance = haversine_m(seed.latitude, seed.longitude, truth.latitude, truth.longitude)
            if distance > arguments.radius_m:
                continue
            similarity = name_similarity(seed.name, truth.name)
            if similarity < arguments.min_name_similarity:
                continue
            hits.append((seed, distance, similarity))
        if not hits:
            continue
        if len(hits) > 1:
            ambiguous += 1
            continue
        seed, distance, similarity = hits[0]
        labels.append(
            {
                "overture_id": seed.seed_id,
                "true_google_place_id": truth.google_place_id,
                "restaurant_id": truth.restaurant_id,
                "overture_name": seed.name,
                "restaurant_name": truth.name,
                "distance_m": round(distance, 1),
                "name_similarity": round(similarity, 3),
            }
        )

    # 同じ Overture 行に2つ以上の正解が付いたら、その行は正解が定まらない。
    counts = Counter(entry["overture_id"] for entry in labels)
    conflicting = {key for key, value in counts.items() if value > 1}
    labels = [entry for entry in labels if entry["overture_id"] not in conflicting]

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(labels[0].keys()) if labels else ["overture_id"])
        writer.writeheader()
        writer.writerows(sorted(labels, key=lambda e: e["overture_id"]))
    print(
        json.dumps(
            {
                "restaurants": restaurant_stats,
                "seeds": len(seeds),
                "labels": len(labels),
                "ambiguous_restaurants": ambiguous,
                "conflicting_overture_ids": len(conflicting),
                "radius_m": arguments.radius_m,
                "min_name_similarity": arguments.min_name_similarity,
                "output": str(arguments.output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    verify = subcommands.add_parser("verify", help="名寄せ結果CSVの正解率を出す")
    verify.add_argument("--matched", type=Path, default=ROOT / "results" / "matched_place_ids.csv")
    verify.add_argument(
        "--seeds",
        type=Path,
        nargs="*",
        help="チェーン判定用の店名頻度を数える seed CSV。省略するとチェーン判定を行わない",
    )
    verify.add_argument("--chain-threshold", type=int, default=DEFAULT_CHAIN_THRESHOLD)
    verify.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    verify.add_argument("--max-distance-m", type=float, default=DEFAULT_MAX_DISTANCE_M)
    verify.add_argument("--min-name-similarity", type=float, default=DEFAULT_MIN_NAME_SIMILARITY)
    verify.add_argument(
        "--name-waiver-distance-m", type=float, default=DEFAULT_NAME_WAIVER_DISTANCE_M
    )
    verify.add_argument("--output", type=Path, default=ROOT / "out" / "ground_truth_summary.json")
    verify.add_argument("--detail-output", type=Path, default=ROOT / "out" / "ground_truth_rows.csv")
    verify.set_defaults(function=command_verify)

    labels = subcommands.add_parser("labels", help="既存DBから正解ラベルを作る")
    labels.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    labels.add_argument("--seeds", type=Path, required=True)
    labels.add_argument("--radius-m", type=float, default=120.0)
    labels.add_argument("--min-name-similarity", type=float, default=0.5)
    labels.add_argument("--output", type=Path, default=ROOT / "out" / "labels.csv")
    labels.set_defaults(function=command_labels)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    arguments = build_parser().parse_args(list(argv) if argv is not None else None)
    arguments.function(arguments)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
