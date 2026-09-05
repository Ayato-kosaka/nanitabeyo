#!/usr/bin/env python3
"""#1273 4_18 の «店名の書き方» ごとに、増えるキー数と中身を実データで測る。

4_18 へ書き方（📍 以外の【】・🏠 行・「店名:」行）を足すとき、**増える件数だけ見て
入れてはいけない**。Google へ聞くのは無料でも 1 日 75,000 request の枠を食うので、
«店名でないものが増えただけ» なら枠を捨てることになる。

このスクリプトは抽出を **1 行も写経せず** 4_18 を import して、
- 書き方ごとの異なりキー数（`sns_name_place_lookup` に無いものだけ）
- 目視できるサンプル（人が «店名かどうか» を 1 件ずつ判定するため）
を出す。判定そのもの（Google への問い合わせ）はしない。
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import importlib

from common_sns import city_from_text  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

resolver = importlib.import_module("4_18_resolve_place_id_by_name")


def main() -> None:
    configure_logging()
    p = argparse.ArgumentParser()
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--source-run-id", default=None)
    p.add_argument("--sample", type=int, default=60, help="書き方ごとに出す目視サンプル数")
    p.add_argument("--seed", type=int, default=1273)
    args = p.parse_args()
    args.city_index_json = None
    args.posts_jsonl = None

    pipeline = BigQueryPipeline()
    by_pair, uniq, geo = resolver.load_city_index(args, pipeline)
    done = resolver.load_done_keys(pipeline)
    print(f"既に聞いたキー: {len(done)} 件")

    # 書き方ごとに «その書き方だけ» でキーを作る（重なりは後で引く）。
    per_source: dict[str, dict] = {}
    posts = list(resolver.load_posts(args, pipeline))
    print(f"読んだ投稿: {len(posts)} 件")
    for source in resolver.ALL_NAME_SOURCES:
        keys, reasons = resolver.build_name_keys(
            posts, by_pair, uniq, geo["pref_of_unique_city"], (source,))
        per_source[source] = {"keys": keys, "reasons": reasons}

    baseline = resolver.build_name_keys(
        posts, by_pair, uniq, geo["pref_of_unique_city"], ("pin", "quoted"))[0]
    every = resolver.build_name_keys(
        posts, by_pair, uniq, geo["pref_of_unique_city"], resolver.ALL_NAME_SOURCES)[0]
    base_ids = {(k.store_name, k.pref, k.city) for k in baseline}

    def undone(keys) -> list:
        return [k for k in keys if (k.store_name, k.pref, k.city) not in done]

    print("\n=== 書き方ごと（その書き方だけを使ったとき） ===")
    print("source\tkeys\t未問い合わせ\t旧(pin+quoted)に無い\t投稿数")
    for source, data in per_source.items():
        keys = data["keys"]
        new = [k for k in undone(keys) if (k.store_name, k.pref, k.city) not in base_ids]
        posts_n = sum(len(v["post_ids"]) for v in keys.values())
        print(f"{source}\t{len(keys)}\t{len(undone(keys))}\t{len(new)}\t{posts_n}")

    print("\n=== 合計 ===")
    print(f"旧（pin+quoted）異なりキー: {len(baseline)} / うち未問い合わせ {len(undone(baseline))}")
    print(f"新（全部）異なりキー:       {len(every)} / うち未問い合わせ {len(undone(every))}")
    print(f"増える未問い合わせキー:     {len(undone(every)) - len(undone(baseline))}")

    rng = random.Random(args.seed)
    for source in resolver.ALL_NAME_SOURCES:
        if source in ("pin", "quoted"):
            continue
        keys = per_source[source]["keys"]
        new = [k for k in undone(keys) if (k.store_name, k.pref, k.city) not in base_ids]
        rng.shuffle(new)
        print(f"\n=== 目視サンプル: {source}（新規 {len(new)} 件から {args.sample} 件） ===")
        for k in new[: args.sample]:
            entry = keys[k]
            print(f"{source}\t{k.store_name}\t{k.pref}{k.city}\t{entry['post_ids'][0]}")


if __name__ == "__main__":
    main()
