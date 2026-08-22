#!/usr/bin/env python3
"""place_id が「どういう店か」を、無料SKUだけで推定する。

主KPI（Google Maps の飲食店 place のうち、オープンデータ経由で place_id を
出せる割合）で取りこぼしている 4 割が、**本物の飲食店なのか、弁当屋・パン屋の
ような周辺業態なのか**で、打ち手が変わる。ノイズなら戦略的に対象外にできるし、
本物の飲食店なら、オープンデータのソースを増やすしかない。

しかし店名も業種も、Google から買えば課金対象SKUになる。取れるのは place_id だけである。

そこで**逆から引く**。カテゴリ語（「ラーメン」「弁当」「ホテル」…）を textQuery に、
その place の推定位置を囲む矩形を locationRestriction にして Text Search を投げ、
**その place_id が返ってくるかどうか**を見る。返ってくれば、Google はその place を
その語に対して関連ありと判定している。語ごとに投げれば、店の輪郭が分かる。

送るのは今までと完全に同じ形のリクエスト（textQuery + locationRestriction、
fieldMask は places.id）である。`includedType` のような未検証のパラメータは使わない。
Nearby の件（#1331）があるので、課金条件を確認できないパラメータは足さない。

推定位置には誤差がある（Nearby の円は半径25m・間隔35mで、位置は円の中心の重心）。
矩形は既定 ±60m と広めに取り、「その語で引いたときに、その place が近所に居るか」を見る。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from free_places import DailyQuotaExhausted, FreePlacesClient, RateLimiter
from runner import ProbeCache
from seeds import Seed, body_query_c

ROOT = Path(__file__).resolve().parent

HALF_SIDE_M = 60.0

# 語は「本物の飲食店か」を分けられるように選ぶ。左から順に、
# 飲食店の中核 / 周辺業態（持ち帰り・製造小売） / 飲食店でないもの。
WORDS = (
    "レストラン", "食堂", "居酒屋", "ラーメン", "寿司", "焼肉", "カフェ", "喫茶店", "バー",
    "パン屋", "ケーキ屋", "弁当", "惣菜", "テイクアウト", "スナック",
    "ホテル", "スーパー", "コンビニ",
)

CORE = frozenset({"レストラン", "食堂", "居酒屋", "ラーメン", "寿司", "焼肉", "カフェ", "喫茶店", "バー"})
PERIPHERAL = frozenset({"パン屋", "ケーキ屋", "弁当", "惣菜", "テイクアウト", "スナック"})
NOT_A_RESTAURANT = frozenset({"ホテル", "スーパー", "コンビニ"})


def pseudo_seed(place_id: str, latitude: float, longitude: float) -> Seed:
    """矩形を組むためだけの Seed。店名は使わない。"""

    return Seed(
        seed_id=place_id,
        name="",
        name_query="",
        address_query="",
        address_quality="",
        latitude=latitude,
        longitude=longitude,
        postcode="",
        freeform="",
        locality="",
        basic_category="",
        confidence=0.0,
        websites="",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, required=True,
                        help="place_id,latitude,longitude の CSV")
    parser.add_argument("--cache", type=Path, default=ROOT / "cache" / "types.sqlite")
    parser.add_argument("--half-side-m", type=float, default=HALF_SIDE_M)
    parser.add_argument("--words", nargs="+", default=list(WORDS))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--qps", type=float, default=5.0)
    parser.add_argument("--workers", type=int, default=5)
    arguments = parser.parse_args()

    api_key = os.environ.get("PLACE_API_TEST")
    if not api_key:
        raise SystemExit("環境変数 PLACE_API_TEST が無い")

    targets = list(csv.DictReader(arguments.targets.open(encoding="utf-8", newline="")))
    if arguments.limit:
        targets = targets[: arguments.limit]
    print(f"対象 {len(targets):,} 件 × 語 {len(arguments.words)} = "
          f"最大 {len(targets) * len(arguments.words):,} リクエスト", flush=True)

    client = FreePlacesClient(api_key, rate_limiter=RateLimiter(arguments.qps))
    cache = ProbeCache(arguments.cache)
    done = {(key[0], key[1]) for key in cache.existing_keys()}
    lock = threading.Lock()
    state = {"requests": 0, "errors": 0, "finished": 0}

    def work(row: dict) -> None:
        seed = pseudo_seed(row["place_id"], float(row["latitude"]), float(row["longitude"]))
        for word in arguments.words:
            if (seed.seed_id, word) in done:
                continue
            body = body_query_c(seed, half_side_m=arguments.half_side_m, name_query=word)
            result = client.search_text(body)
            cache.put(seed.seed_id, word, result, body)
            with lock:
                state["requests"] += 1
                state["errors"] += 0 if result.ok else 1
        with lock:
            state["finished"] += 1
            if state["finished"] % 50 == 0:
                print(f"  {state['finished']}/{len(targets)}  "
                      f"リクエスト {state['requests']:,}", flush=True)

    try:
        with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
            list(pool.map(work, targets))
    except DailyQuotaExhausted as error:
        print(f"日次クォータ枯渇で中断: {error}", file=sys.stderr)
    finally:
        cache.flush()

    print(json.dumps({"requests": state["requests"], "errors": state["errors"],
                      "sku": "Text Search (IDs Only) のみ = $0.00"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
