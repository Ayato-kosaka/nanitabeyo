#!/usr/bin/env python3
"""必要になった probe だけを送る。判定結果は変えずにリクエスト数を44%減らす。

`box_unique` は次の順で判定する。

1. ±25m の矩形に同名が1件だけ → その1件を A か B が挙げていれば確定
2. そうでなければ ±250m の矩形に同名が1件だけ → 同じく A か B の裏取り

ここから、送らなくてよい probe が決まる。

- 矩形がどちらも一意でない seed は、A も B も見る必要がない（確定しえない）
- 裏取りは A で足りることが多く、その場合 B は要らない
- ±25m で決まれば ±250m は要らない

取得済みキャッシュ2,871件で確かめたところ、**判定が変わった seed は0件**で、
送る本数は 4.00 → 2.24 本/店になった。全件 1,458,458 行なら 583万 → 327万
リクエストで、日次75,000のままでも 77.8日 → 43.6日 に縮む。

Text Search の分次上限は600（=10 req/s）で、本番APIと同じキーを共有している。
バッチが分次を占有すると本番が429で巻き添えになるので、`--qps` は既定で控えめに
してある。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from free_places import DailyQuotaExhausted, FreePlacesClient, RateLimiter, SearchResult
from matching import PROBE_A, PROBE_B, PROBE_C_TIGHT, PROBE_C_WIDE
from runner import ProbeCache
from seeds import Seed, body_query_a, body_query_b, body_query_c, read_seeds

ROOT = Path(__file__).resolve().parent

TIGHT_HALF_SIDE_M = 25.0
WIDE_HALF_SIDE_M = 250.0
BIAS_RADIUS_M = 150.0


@dataclass
class Outcome:
    seed_id: str
    place_id: str | None
    detail: str
    requests: int


class AdaptiveProber:
    """1 seed 分の judgement を、必要な probe だけ取りながら進める。"""

    def __init__(self, client: FreePlacesClient, cache: ProbeCache):
        self._client = client
        self._cache = cache
        self._lock = threading.Lock()
        self.requests = 0

    def _get(self, seed: Seed, probe: str) -> set[str]:
        cached = self._cache.get(seed.seed_id, probe)
        if cached is not None:
            return set(cached.place_ids) if cached.ok else set()
        if probe == PROBE_A:
            body = body_query_a(seed, radius_m=BIAS_RADIUS_M)
        elif probe == PROBE_B:
            body = body_query_b(seed)
        elif probe == PROBE_C_TIGHT:
            body = body_query_c(seed, half_side_m=TIGHT_HALF_SIDE_M)
        else:
            body = body_query_c(seed, half_side_m=WIDE_HALF_SIDE_M)
        result = self._client.search_text(body)
        with self._lock:
            self.requests += 1
        self._cache.put(seed.seed_id, probe, result, body)
        return set(result.place_ids) if result.ok else set()

    def run(self, seed: Seed) -> Outcome:
        if not seed.name_query:
            return Outcome(seed.seed_id, None, "missing_name", 0)
        before = self.requests
        support_a: set[str] | None = None
        support_b: set[str] | None = None

        def supported(candidate: str) -> bool:
            nonlocal support_a, support_b
            if support_a is None:
                support_a = self._get(seed, PROBE_A)
            if candidate in support_a:
                return True
            if not seed.address_query:
                # 住所が無ければ B は A と同じクエリになる。送る意味がない。
                return False
            if support_b is None:
                support_b = self._get(seed, PROBE_B)
            return candidate in support_b

        tight = self._get(seed, PROBE_C_TIGHT)
        if len(tight) == 1:
            candidate = next(iter(tight))
            if supported(candidate):
                return Outcome(seed.seed_id, candidate, "tight_unique_in_ab",
                               self.requests - before)

        wide = self._get(seed, PROBE_C_WIDE)
        if len(wide) == 1:
            candidate = next(iter(wide))
            if supported(candidate):
                return Outcome(seed.seed_id, candidate, "wide_unique_in_ab",
                               self.requests - before)

        detail = "no_candidate_in_box" if not tight and not wide else "box_not_unique"
        return Outcome(seed.seed_id, None, detail, self.requests - before)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, nargs="+", required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    # 分次上限600（=10 req/s）を本番APIと共有しているので、既定は半分に抑える。
    parser.add_argument("--qps", type=float, default=5.0)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--execute", action="store_true", help="付けないと件数を出して終わる")
    arguments = parser.parse_args()

    seeds: list[Seed] = []
    for path in arguments.seeds:
        seeds.extend(read_seeds(path))
    if arguments.limit:
        seeds = seeds[: arguments.limit]
    print(f"seed {len(seeds):,} 件", flush=True)
    if not arguments.execute:
        print("--execute が無いので送信しない")
        return 0

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")
    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(qps=arguments.qps))
    cache = ProbeCache(arguments.cache)
    prober = AdaptiveProber(client, cache)

    outcomes: list[Outcome] = []
    done = threading.Lock()
    counter = {"n": 0}
    stopped = threading.Event()

    def work(seed: Seed) -> None:
        if stopped.is_set():
            return
        try:
            outcome = prober.run(seed)
        except DailyQuotaExhausted:
            stopped.set()
            print("!! 1日あたりの上限に達したので中断する（キャッシュは保存済み）", flush=True)
            return
        with done:
            outcomes.append(outcome)
            counter["n"] += 1
            if counter["n"] % 200 == 0:
                print(
                    f"  {counter['n']:,}/{len(seeds):,}  リクエスト {prober.requests:,}"
                    f"  ({prober.requests / max(counter['n'], 1):.2f}本/店)",
                    flush=True,
                )

    with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
        list(pool.map(work, seeds))
    cache.flush()
    cache.close()

    matched = [item for item in outcomes if item.place_id]
    report = {
        "seeds": len(outcomes),
        "matched": len(matched),
        "match_rate": round(len(matched) / len(outcomes), 6) if outcomes else 0.0,
        "requests": prober.requests,
        "requests_per_seed": round(prober.requests / len(outcomes), 4) if outcomes else 0.0,
        "http_errors": client.error_count,
        "interrupted_by_quota": stopped.is_set(),
        "sku": "Text Search (IDs Only) のみ = $0.00",
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
