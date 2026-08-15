#!/usr/bin/env python3
"""±1km 層の「空撃ち率」を、ラベル無しで測る。

±1km 矩形（probe ``c_huge``）を足すと ① 名寄せ率は上がるが、正しさを確かめる
ラベルが足りない。ラベル集合は「既存DBと座標で突き合わせて作った」ものなので、
座標がずれている行――まさに ±1km が効く母集団――がほとんど入っていない。
実測でも、ラベル 6,000 件のうち未確定は 177 件、±1km が新たに確定させたのは
2 件しかなく、この 2 件で層の精度は語れない。

そこで、ラベルの代わりに**帰無仮説**で測る。

座標を同じ密度帯の別地点に入れ替えると、その seed の本当の店は ±1km 矩形の
外に出る。つまり**この条件で層が発火したら、それは必ず誤りである**。
発火率 f0 は「本当の店が箱に居ないときに、それでも1件に絞れてしまう率」で、
±1km 層が生む誤りの上限を与える。

    誤り件数 ≤ 未確定件数 × f0

座標の入れ替えは 0.5°（約55km）のセル内で行う。都市は都市と、郊外は郊外と
入れ替わるので、「移した先が畑で0件だったから安全に見えた」という下駄を防げる。
移動距離が 3km 未満になった場合だけ、緯度 +0.05°（約5.5km）の平行移動に落とす。

送るのは Text Search (IDs Only) のみ = $0.00。
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
import os
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from free_places import DailyQuotaExhausted, FreePlacesClient, RateLimiter
from runner import ProbeCache
from seeds import Seed, body_query_a, body_query_c, body_query_ca, read_seeds

ROOT = Path(__file__).resolve().parent

HUGE_HALF_SIDE_M = 1000.0
BIAS_RADIUS_M = 150.0
CELL_DEGREES = 0.5
MIN_SHIFT_M = 3000.0
FALLBACK_SHIFT_DEGREES = 0.05

PROBE_A_NULL = "a_null"
PROBE_HUGE_NULL = "c_huge_null"
PROBE_CA_HUGE_NULL = "ca_huge_null"
PROBE_500_NULL = "c_500_null"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def displace(seeds: list[Seed]) -> list[Seed]:
    """同じ密度帯の中で座標を入れ替える。"""

    cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, seed in enumerate(seeds):
        cells[(int(seed.latitude / CELL_DEGREES), int(seed.longitude / CELL_DEGREES))].append(index)

    moved = list(seeds)
    for members in cells.values():
        step = max(1, len(members) // 2)
        for offset, index in enumerate(members):
            donor = seeds[members[(offset + step) % len(members)]]
            seed = seeds[index]
            distance = haversine_m(seed.latitude, seed.longitude, donor.latitude, donor.longitude)
            if distance >= MIN_SHIFT_M:
                moved[index] = dataclasses.replace(
                    seed, latitude=donor.latitude, longitude=donor.longitude
                )
            else:
                # セル内に相手が居ない（1件だけ、など）ときの逃げ道。
                moved[index] = dataclasses.replace(
                    seed, latitude=seed.latitude + FALLBACK_SHIFT_DEGREES
                )
    return moved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--ids", type=Path, required=True, help="対象 seed_id の一覧（1行1件）")
    parser.add_argument("--cache", type=Path, default=ROOT / "cache" / "null_huge.sqlite")
    parser.add_argument("--qps", type=float, default=8.0)
    parser.add_argument("--workers", type=int, default=8)
    arguments = parser.parse_args()

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")

    wanted = {line.strip() for line in arguments.ids.read_text().splitlines() if line.strip()}
    seeds = [seed for seed in read_seeds(arguments.seeds) if seed.seed_id in wanted]
    seeds = [seed for seed in seeds if seed.name_query]
    moved = displace(seeds)
    shifts = [
        haversine_m(a.latitude, a.longitude, b.latitude, b.longitude)
        for a, b in zip(seeds, moved)
    ]
    shifts.sort()
    print(
        f"対象 {len(moved):,} 件 / 移動距離 中央値 {shifts[len(shifts) // 2] / 1000:.1f}km "
        f"最小 {shifts[0] / 1000:.1f}km",
        flush=True,
    )

    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(arguments.qps))
    cache = ProbeCache(arguments.cache)
    done = {(key[0], key[1]) for key in cache.existing_keys()}
    lock = threading.Lock()
    state = {"requests": 0, "errors": 0, "finished": 0}

    def work(seed: Seed) -> None:
        bodies = [
            (PROBE_HUGE_NULL, body_query_c(seed, half_side_m=HUGE_HALF_SIDE_M)),
            (PROBE_A_NULL, body_query_a(seed, radius_m=BIAS_RADIUS_M)),
            (PROBE_500_NULL, body_query_c(seed, half_side_m=500.0)),
        ]
        if seed.address_query:
            bodies.append((PROBE_CA_HUGE_NULL, body_query_ca(seed, half_side_m=HUGE_HALF_SIDE_M)))
        for probe, body in bodies:
            if (seed.seed_id, probe) in done:
                continue
            result = client.search_text(body)
            cache.put(seed.seed_id, probe, result, body)
            with lock:
                state["requests"] += 1
                state["errors"] += 0 if result.ok else 1
        with lock:
            state["finished"] += 1
            if state["finished"] % 200 == 0:
                print(f"  {state['finished']}/{len(moved)}", flush=True)

    try:
        with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
            list(pool.map(work, moved))
    except DailyQuotaExhausted as error:
        print(f"日次クォータ枯渇で中断: {error}", file=sys.stderr)
    finally:
        cache.flush()

    print(json.dumps({"requests": state["requests"], "errors": state["errors"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
