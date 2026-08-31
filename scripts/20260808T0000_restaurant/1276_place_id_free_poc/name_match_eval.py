#!/usr/bin/env python3
"""店名照合器を、正例と負例のある評価セットで採点する。

網羅率を「近傍にあって名前も一致する既存DB行の割合」で測っているが、この
「名前も一致する」の判定が弱いと網羅率を過小評価する。実際、類似度 0.6〜0.7 の
帯には `カメチク 近江八幡店` ⇔ `カメチク` のような同一店舗が2万件以上あった。

照合器を緩めれば網羅率は上がるが、別の店を同じ店と見なせば意味がない。だから
緩める前に、正しさを測れる評価セットを用意する。どちらも人手のラベル付けを要しない。

- 正例: 名寄せで place_id を確定し、既存DB の place_id と一致した行。
        オープンデータ側の店名と既存DB側の店名は、同じ店を指していると分かっている。
- 負例: 100m 以内にある、**place_id が異なる**既存DB行どうしの組。
        place_id が違えば Google 上で別の店なので、同じ店と判定したら誤りである。

負例は密集地から作られるので、実運用で間違えやすい組がそのまま集まる。
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
from pathlib import Path
from typing import Callable, Iterable

from ground_truth import haversine_m, load_restaurants

ROOT = Path(__file__).resolve().parent
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def build_positives(matched: Path, restaurants: dict) -> list[tuple[str, str]]:
    by_place = {row.google_place_id: row for row in restaurants.values()}
    pairs: list[tuple[str, str]] = []
    with matched.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            truth = by_place.get(row["google_place_id"])
            if truth is not None:
                pairs.append((row["name"], truth.name))
    return pairs


def build_negatives(restaurants: dict, *, radius_m: float, limit: int) -> list[tuple[str, str]]:
    cell = radius_m / 111_320.0
    grid: dict[tuple[int, int], list] = {}
    for row in restaurants.values():
        grid.setdefault((int(row.latitude / cell), int(row.longitude / cell)), []).append(row)
    pairs: list[tuple[str, str]] = []
    for bucket in grid.values():
        # 同じセルの中だけで組を作る。隣接セルまで見ると組の数が爆発するうえ、
        # 「間違えやすい組」を集めるという目的には同一セルで十分である。
        for left, right in itertools.combinations(bucket, 2):
            if left.google_place_id == right.google_place_id:
                continue
            if haversine_m(left.latitude, left.longitude, right.latitude, right.longitude) > radius_m:
                continue
            pairs.append((left.name, right.name))
            if len(pairs) >= limit:
                return pairs
    return pairs


def score(
    name: str,
    similarity: Callable[[str, str], float],
    positives: Iterable[tuple[str, str]],
    negatives: Iterable[tuple[str, str]],
    thresholds: Iterable[float],
) -> list[dict]:
    positive_scores = [similarity(a, b) for a, b in positives]
    negative_scores = [similarity(a, b) for a, b in negatives]
    rows = []
    for threshold in thresholds:
        hit = sum(1 for value in positive_scores if value >= threshold)
        false = sum(1 for value in negative_scores if value >= threshold)
        rows.append(
            {
                "matcher": name,
                "threshold": round(threshold, 2),
                "recall": round(hit / len(positive_scores), 5) if positive_scores else 0.0,
                "false_positive_rate": round(false / len(negative_scores), 5) if negative_scores else 0.0,
                "true_positives": hit,
                "false_positives": false,
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restaurants", type=Path, default=ROOT / "out" / "restaurants.csv")
    parser.add_argument("--matched", type=Path, default=ROOT / "results" / "matched_place_ids.csv")
    parser.add_argument("--negative-radius-m", type=float, default=100.0)
    parser.add_argument("--negative-limit", type=int, default=200_000)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    restaurants, _ = load_restaurants(arguments.restaurants)
    positives = build_positives(arguments.matched, restaurants)
    negatives = build_negatives(
        restaurants, radius_m=arguments.negative_radius_m, limit=arguments.negative_limit
    )
    print(f"正例 {len(positives)} / 負例 {len(negatives)}", flush=True)

    from jp_text import name_similarity as baseline

    matchers: dict[str, Callable[[str, str], float]] = {"現行": baseline}
    try:
        from jp_name_match import similarity as improved

        matchers["改良"] = improved
    except ImportError:
        pass

    thresholds = [i / 20 for i in range(2, 21)]
    rows: list[dict] = []
    for name, function in matchers.items():
        rows.extend(score(name, function, positives, negatives, thresholds))

    for row in rows:
        print(
            f"  {row['matcher']:<4} しきい値 {row['threshold']:<5} "
            f"再現率 {row['recall']:.4f}  誤結合率 {row['false_positive_rate']:.5f} "
            f"({row['false_positives']}/{len(negatives)})"
        )
    report = {"positives": len(positives), "negatives": len(negatives), "rows": rows}
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
