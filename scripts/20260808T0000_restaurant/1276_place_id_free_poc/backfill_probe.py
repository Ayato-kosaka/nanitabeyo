#!/usr/bin/env python3
"""指定した probe を、まだ取っていない seed について取り直す。

`adaptive_probe` は判定に要らない probe を送らない。リクエストは 44% 減るが、
あとから「±250m の箱が一意か」のような**判定に使わなかった条件**を評価しようと
すると、送っていない分が欠測になる。欠測を「0件」と読むと、危ない行を安全側に
数えてしまい、ゲートの効果を過大評価する（実測で 1,030 件が欠測だった）。

そこで、評価に必要な probe だけを後から埋める。送るのは
Text Search (IDs Only) のみ = $0.00。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from free_places import DailyQuotaExhausted, FreePlacesClient, RateLimiter
from runner import ProbeCache
from jp_name_match import search_variant
from seeds import Seed, body_query_a, body_query_b, body_query_c, body_query_ca, read_seeds

ROOT = Path(__file__).resolve().parent

HALF_SIDES = {"c_tight": 25.0, "c_wide": 250.0, "c_500": 500.0, "c_huge": 1000.0}
ADDRESS_HALF_SIDES = {"ca_huge": 1000.0}
# 店名を「読める短縮形」に置き換えて同じ矩形を引き直す probe。
# Google 側の表記が違うせいで矩形が空になった行を拾い直すためのもの。
ALT_NAME_HALF_SIDES = {"c_tight_alt": 25.0, "c_wide_alt": 250.0}
BIAS_RADIUS_M = 150.0


def build_body(seed: Seed, probe: str) -> dict:
    if probe == "a":
        return body_query_a(seed, radius_m=BIAS_RADIUS_M)
    if probe == "b":
        return body_query_b(seed)
    if probe in HALF_SIDES:
        return body_query_c(seed, half_side_m=HALF_SIDES[probe])
    if probe in ADDRESS_HALF_SIDES:
        return body_query_ca(seed, half_side_m=ADDRESS_HALF_SIDES[probe])
    if probe in ALT_NAME_HALF_SIDES:
        return body_query_c(
            seed,
            half_side_m=ALT_NAME_HALF_SIDES[probe],
            name_query=search_variant(seed.name),
        )
    raise SystemExit(f"未知の probe: {probe}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--probe", required=True, choices=["a", "b", *HALF_SIDES, *ADDRESS_HALF_SIDES, *ALT_NAME_HALF_SIDES])
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--qps", type=float, default=6.0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int)
    arguments = parser.parse_args()

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")

    cache = ProbeCache(arguments.cache)
    have = {(key[0], key[1]) for key in cache.existing_keys()}
    targets = [
        seed
        for seed in read_seeds(arguments.seeds)
        if seed.name_query and (seed.seed_id, arguments.probe) not in have
    ]
    if arguments.probe in ("b", *ADDRESS_HALF_SIDES):
        targets = [seed for seed in targets if seed.address_query]
    if arguments.probe in ALT_NAME_HALF_SIDES:
        # 短縮形が元の店名と同じなら、同じクエリを二度投げることになる。送らない。
        targets = [
            seed for seed in targets if search_variant(seed.name) not in ("", seed.name_query)
        ]
    if arguments.limit:
        targets = targets[: arguments.limit]
    print(f"{arguments.probe} を取る対象: {len(targets):,} 件", flush=True)

    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(arguments.qps))
    lock = threading.Lock()
    state = {"requests": 0, "errors": 0}

    def work(seed: Seed) -> None:
        result = client.search_text(build_body(seed, arguments.probe))
        cache.put(seed.seed_id, arguments.probe, result, build_body(seed, arguments.probe))
        with lock:
            state["requests"] += 1
            state["errors"] += 0 if result.ok else 1
            if state["requests"] % 200 == 0:
                print(f"  {state['requests']}/{len(targets)}", flush=True)

    try:
        with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
            list(pool.map(work, targets))
    except DailyQuotaExhausted as error:
        print(f"日次クォータ枯渇で中断: {error}", file=sys.stderr)
    finally:
        cache.flush()

    print(json.dumps({"requests": state["requests"], "errors": state["errors"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
