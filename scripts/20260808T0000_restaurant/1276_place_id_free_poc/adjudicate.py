#!/usr/bin/env python3
"""名寄せ結果と既存DBの place_id が食い違ったとき、どちらが正しいかを無料で裁定する。

②（名寄せした place_id の正解率）は既存 `public.restaurants` との突合で測っている。
しかし既存DBは bulk-import の一回きりのスナップショットで、Google 側の統廃合には
追随していない。突合の不一致をすべて「名寄せの誤り」に数えると、DB が古いだけの
行まで誤りに算入されてしまう。逆に何でも「DB が古い」と言えば測っていないに等しい。

そこで、人の判断を挟まずに決まる裁定を1つ用意する。使うのは無料SKUだけである。

- Place Details (IDs Only): その place_id が今も生きているか
- Text Search (IDs Only) + locationRestriction 矩形: 店名で引いたとき、その
  place_id が座標からどれだけの箱に入るか

locationRestriction は矩形外を実際に切り落とす（大阪の店名を東京の矩形で引くと
0件になることを確認済み）。したがって「±25m の箱に入る」は「Google 側でもその
place はこの座標のほぼ真上にある」を意味する。

判定は次の4つ。境界は先に決めてから全件に一律で当てる。

- duplicate   : 両方とも ±5m の箱に入る。同じ店に place_id が2つある状態。
                （利用者の判断で「正解扱い」とすることが決まっている）
- db_stale    : 自分の place_id は ±25m に入るが、DB の place_id は ±100m にも
                入らない。DB 側が実店舗の位置と結びついていない。
- mine_wrong  : DB の place_id が ±25m に入り、自分のものは入らない。名寄せの誤り。
- inconclusive: 上のどれでもない。安全側に倒して誤り扱いで数える。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

from free_places import FreePlacesClient, RateLimiter
from seeds import Seed, body_query_c, read_seeds

ROOT = Path(__file__).resolve().parent

DUPLICATE_BOX_M = 5.0
CONFIRM_BOX_M = 25.0
FAR_BOX_M = 100.0

VERDICT_DUPLICATE = "duplicate"
VERDICT_DB_STALE = "db_stale"
VERDICT_MINE_WRONG = "mine_wrong"
VERDICT_INCONCLUSIVE = "inconclusive"

# 名寄せ側の誤りとして数えるもの。duplicate と db_stale は名寄せの誤りではない。
COUNTS_AS_ERROR = frozenset({VERDICT_MINE_WRONG, VERDICT_INCONCLUSIVE})


def adjudicate(
    client: FreePlacesClient, seed: Seed, mine: str, theirs: str
) -> tuple[str, dict[str, Any]]:
    boxes: dict[str, dict[str, Any]] = {}
    membership: dict[float, tuple[bool, bool]] = {}
    for half in (DUPLICATE_BOX_M, CONFIRM_BOX_M, FAR_BOX_M):
        result = client.search_text(body_query_c(seed, half_side_m=half))
        found = set(result.place_ids) if result.ok else set()
        membership[half] = (mine in found, theirs in found)
        boxes[f"{half:g}m"] = {
            "n": len(found),
            "mine": mine in found,
            "theirs": theirs in found,
            "http_status": result.http_status,
        }

    alive_mine = client.refresh_place_id(mine)
    alive_theirs = client.refresh_place_id(theirs)
    evidence = {
        "boxes": boxes,
        "alive_mine": alive_mine.ok and mine in alive_mine.place_ids,
        "alive_theirs": alive_theirs.ok and theirs in alive_theirs.place_ids,
    }

    mine_5, theirs_5 = membership[DUPLICATE_BOX_M]
    mine_25, theirs_25 = membership[CONFIRM_BOX_M]
    mine_100, theirs_100 = membership[FAR_BOX_M]

    if mine_5 and theirs_5:
        return VERDICT_DUPLICATE, evidence
    if theirs_25 and not mine_25:
        return VERDICT_MINE_WRONG, evidence
    if mine_25 and not theirs_100:
        return VERDICT_DB_STALE, evidence
    return VERDICT_INCONCLUSIVE, evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mismatches", type=Path, required=True,
                        help="seed_id, mine, theirs の3列を持つ CSV")
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--qps", type=float, default=6.0)
    arguments = parser.parse_args()

    pairs: dict[str, tuple[str, str]] = {}
    with arguments.mismatches.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            pairs[row["seed_id"]] = (row["mine"], row["theirs"])
    seeds = {seed.seed_id: seed for seed in read_seeds(arguments.seeds) if seed.seed_id in pairs}

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")
    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(qps=arguments.qps))

    verdicts: Counter = Counter()
    rows: list[dict[str, Any]] = []
    for seed_id, (mine, theirs) in pairs.items():
        seed = seeds.get(seed_id)
        if seed is None:
            verdicts["seed_missing"] += 1
            continue
        verdict, evidence = adjudicate(client, seed, mine, theirs)
        verdicts[verdict] += 1
        rows.append(
            {
                "seed_id": seed_id,
                "name": seed.name,
                "mine": mine,
                "theirs": theirs,
                "verdict": verdict,
                "evidence": json.dumps(evidence, ensure_ascii=False),
            }
        )
        print(f"{verdict:<13} 『{seed.name}』", flush=True)

    judged = sum(verdicts[key] for key in
                 (VERDICT_DUPLICATE, VERDICT_DB_STALE, VERDICT_MINE_WRONG, VERDICT_INCONCLUSIVE))
    errors = sum(verdicts[key] for key in COUNTS_AS_ERROR)
    report = {
        "pairs": len(pairs),
        "verdicts": dict(verdicts),
        "counted_as_matching_error": errors,
        "not_a_matching_error": judged - errors,
        "requests": client.request_count,
        "http_errors": client.error_count,
        "sku": "Text Search (IDs Only) / Place Details (IDs Only) のみ = $0.00",
    }
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        with arguments.output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(
                stream, fieldnames=["seed_id", "name", "mine", "theirs", "verdict", "evidence"]
            )
            writer.writeheader()
            writer.writerows(rows)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
