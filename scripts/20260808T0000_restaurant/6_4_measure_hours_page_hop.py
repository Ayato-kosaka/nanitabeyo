#!/usr/bin/env python3
"""#1666 «営業時間のページへ 1 ホップ辿る» とどれだけ増えるかを測る（読み取り専用）。

## なぜ要るか

東京駅の窓（近い順 1,000 件）は、website を持つ 634 店を**全部歩いた上で** 144 店
（14.4%）で頭打ちになった。残り 500 店は «未訪問» ではなく **歩いて失敗した店**である
（[run 35988272760](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/35988272760) の dry-run が同じ 582 件を再提示する）。

諦めた理由の内訳で最大の `no_time_span`（97 件）を見ると、抜粋も候補の website も

- 集約サイト（`r.gnavi.co.jp`）
- 施設のディレクトリ（`tokyoinfo.com`）
- ブランドのトップページ（`kiyoken.com/index.html`）
- **商品ページ**（`tokyobanana.jp/products/banana_pokemon.html`）

で、**そもそも営業時間が載っていないページを読んでいた**。パーサを強くしても増えない。

> ⚠️ ただしこれは **仮説**である。97 件のうち抜粋 3 件と候補 20 件しか見ていない。
> «1 ホップ辿ると何件が parsed になるか» を測ってから実装する。

## 何をするか

website を 1 回取り、**その中のリンクから «営業時間がありそうなページ» を 1 つ選んで**
もう 1 回だけ取る。両方を `classify_page_with_reason` にかけ、

    top だけ → 何件 parsed / hop も見ると → 何件 parsed

を出す。**DB へは 1 行も書かない。** 実装するかどうかはこの数字で決める。

## ⚠️ 1 ホップだけ

リンクを辿り始めると際限が無い。**1 店につき追加 1 リクエストまで**に固定する
（相手のサイトへの負荷と、全件へ広げたときの所要時間の両方が読めなくなるため）。

実行:
    python3 scripts/20260808T0000_restaurant/6_4_measure_hours_page_hop.py \\
        --schema dev --limit 120 --near 35.681236,139.767125 --near-radius-m 700
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ⚠️ 取りに行く作法・分類はクローラと同じものを使う（写経しない）。
from official_site_crawl import (  # noqa: E402
    HOP_PATTERNS,
    classify_page_with_reason,
    fetch,
    html_to_text,
    pick_hop,
    robots_allows,
)

# ⚠️ 候補の絞り込みもクローラと同じ SQL を使う。別の集合を測ると意味が無い。
import importlib  # noqa: E402

_crawler = importlib.import_module("6_3_crawl_official_site_hours")
CANDIDATE_SQL = _crawler.CANDIDATE_SQL
NEAR_CLAUSE = _crawler.NEAR_CLAUSE
ORDER_BY_DISTANCE = _crawler.ORDER_BY_DISTANCE
SOURCE = _crawler.SOURCE
parse_near = _crawler.parse_near

LOGGER = logging.getLogger(__name__)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    parser.add_argument("--country", default="JP")
    parser.add_argument("--limit", type=int, required=True, help="⚠️ 必須。標本の件数")
    parser.add_argument("--seed", default="1666")
    parser.add_argument("--near", required=True, help='"緯度,経度"')
    parser.add_argument("--near-radius-m", type=float, default=700.0)
    parser.add_argument("--min-interval", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--examples-per-bucket", type=int, default=3)
    args = parser.parse_args()

    from pg_sync_common import connect_postgres
    from pipeline_common import configure_logging
    from psycopg2 import sql as sql_module

    configure_logging()
    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            # PostGIS は extensions スキーマに居る（#2039）
            cursor.execute(
                sql_module.SQL("SET search_path TO {}, extensions, public").format(
                    sql_module.Identifier(args.schema)
                )
            )
            cursor.execute("SET default_transaction_read_only = on")

        near_lat, near_lon = parse_near(args.near)
        sql = CANDIDATE_SQL.format(
            schema=args.schema,
            only_missing="",  # ⚠️ 失敗した店こそ測りたいので «まだ無い店» で絞らない
            near=NEAR_CLAUSE,
            order=ORDER_BY_DISTANCE,
        )
        params = {
            "country": args.country,
            "seed": args.seed,
            "limit": args.limit,
            "source": SOURCE,
            "near_lat": near_lat,
            "near_lon": near_lon,
            "near_radius_m": args.near_radius_m,
        }
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            candidates = cursor.fetchall()
    finally:
        connection.rollback()
        connection.close()

    LOGGER.info("標本: %d 件（近い順 / 半径 %.0fm）", len(candidates), args.near_radius_m)

    top_buckets: Counter[str] = Counter()
    hop_buckets: Counter[str] = Counter()
    hop_labels: Counter[str] = Counter()
    # top では取れず hop で取れた（= 1 ホップの効果そのもの）
    rescued: list[tuple[str, str, str]] = []
    no_hop_found = 0
    robots_cache: dict = {}
    last_request_at = 0.0

    def throttle():
        nonlocal last_request_at
        wait = args.min_interval - (time.monotonic() - last_request_at)
        if wait > 0:
            time.sleep(wait)
        last_request_at = time.monotonic()

    for i, (_rid, name, url) in enumerate(candidates, start=1):
        if i % 20 == 0:
            LOGGER.info(
                "  … %d/%d（top parsed=%d / hop parsed=%d / 救出=%d）",
                i,
                len(candidates),
                top_buckets["parsed"],
                hop_buckets["parsed"],
                len(rescued),
            )
        throttle()
        try:
            if not robots_allows(url, robots_cache, args.timeout):
                top_buckets["blocked_by_robots"] += 1
                continue
            html, _reason = fetch(url, args.timeout)
        except Exception:  # noqa: BLE001
            html = None
        if html is None:
            top_buckets["unreachable"] += 1
            continue

        top_bucket, _r = classify_page_with_reason(html_to_text(html))
        top_buckets[top_bucket] += 1

        if top_bucket == "parsed":
            hop_buckets["parsed"] += 1  # top で取れているので hop は要らない
            continue

        hop_url, label = pick_hop(html, url)
        if not hop_url:
            no_hop_found += 1
            hop_buckets[top_bucket] += 1
            continue
        hop_labels[label] += 1

        throttle()
        try:
            if not robots_allows(hop_url, robots_cache, args.timeout):
                hop_buckets[top_bucket] += 1
                continue
            hop_html, _r2 = fetch(hop_url, args.timeout)
        except Exception:  # noqa: BLE001
            hop_html = None
        if hop_html is None:
            hop_buckets[top_bucket] += 1
            continue

        hop_bucket, _r3 = classify_page_with_reason(html_to_text(hop_html))
        hop_buckets[hop_bucket] += 1
        if hop_bucket == "parsed":
            rescued.append((name, url, hop_url))

    total = len(candidates)
    LOGGER.info("===== 結果 =====")
    LOGGER.info("標本                 : %d 件", total)
    LOGGER.info("--- website のトップだけを読んだとき ---")
    for key in ("parsed", "mentions_hours_unparsed", "no_hours_mentioned", "not_japanese_page", "unreachable", "blocked_by_robots"):
        LOGGER.info("  %-24s: %d", key, top_buckets[key])
    LOGGER.info("--- 1 ホップ辿ったとき ---")
    for key in ("parsed", "mentions_hours_unparsed", "no_hours_mentioned", "not_japanese_page"):
        LOGGER.info("  %-24s: %d", key, hop_buckets[key])
    LOGGER.info("辿る先が見つからなかった: %d 件", no_hop_found)
    if hop_labels:
        LOGGER.info("辿った規則の内訳")
        for label, n in hop_labels.most_common():
            LOGGER.info("  %4d  %s", n, label)

    top_parsed = top_buckets["parsed"]
    hop_parsed = hop_buckets["parsed"]
    LOGGER.info("")
    LOGGER.info("⭐ parsed: トップだけ %d 件（%.1f%%） → 1 ホップ %d 件（%.1f%%）",
                top_parsed, 100 * top_parsed / total if total else 0,
                hop_parsed, 100 * hop_parsed / total if total else 0)
    LOGGER.info("⭐ 1 ホップで救出できた店: %d 件", len(rescued))
    for name, url, hop_url in rescued[: args.examples_per_bucket]:
        LOGGER.info("    例: %s  %s → %s", name, url, hop_url)
    LOGGER.info("")
    LOGGER.info("⚠️ このスクリプトは DB へ 1 行も書いていない（測るだけ）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
