#!/usr/bin/env python3
"""#1273 分母を1つに定める: #843 の EntityResolver を直接回して統合母集団を確定する

## なぜ

`measure_population_denominator.py` では統合母集団を 870,114 〜 1,159,362 の幅でしか
出せず、Meta 経路のカバレッジが **60.5% 〜 80.6%** と 70% を跨いでしまった。
幅の原因は「表記ゆれの名寄せを自前の粗い規則でやったから」である。

#843 には既に本物の名寄せ器がある（`scripts/20260808T0000_restaurant/entity_resolution.py`
の `EntityResolver`。S2セル + haversine + trigram 類似度）。`2_2_build_restaurant_seed_catalog.py`
はこれを BigQuery 経由で回すが、**`EntityResolver` 自体は純粋な Python** なので
BigQuery なしで直接回せる。プロジェクトの正規のロジックで分母を1つに定める。

## 注意

- 母集団は #1273 の定義に合わせ Overture + IFAS + OSM の3ソース。
  `existing_pg`（本番 restaurants 103,528）は #843 の pipeline では入るが、
  #1273 のカバレッジ議論では母集団に含めていないので、ここでも入れない。
- fixture CSV には住所文字列が無く region + locality しか無い。
  `EntityResolver` の主判定は座標と名称なので影響は限定的だが、
  住所一致による救済が効かない分**名寄せは保守的（=母集団は多め）に出る**。
  つまりここで出る数字は真の母集団の**上寄り**である。

実行:
    python3 measure_seed_population.py            # 全件
    python3 measure_seed_population.py --limit 50000   # 動作確認
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from entity_resolution import EntityResolver, SourceRecord  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

# entity_resolution.SOURCE_PRIORITY のキーに合わせる。
SOURCES = {
    "overture_jp_food.csv": "overture",
    "osm_jp_food.csv": "osm",
    "ifas_jp_food.csv": "ifas",
}

META_REACHABLE = 701_284
OWNER_TARGET_PCT = 70.0


def load_records(limit: int | None):
    csv.field_size_limit(10**7)
    n = 0
    for filename, source in SOURCES.items():
        path = FIXTURES / filename
        if not path.exists():
            raise SystemExit(f"fixture が無い: {path}")
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = (row.get("name") or "").strip()
                if not name:
                    continue
                try:
                    lat = float(row["latitude"])
                    lon = float(row["longitude"])
                except (TypeError, ValueError):
                    continue
                if not (24 <= lat <= 46 and 122 <= lon <= 154):
                    continue
                # fixture に住所文字列が無いので region + locality で代用する。
                address = f"{(row.get('region') or '').strip()}{(row.get('locality') or '').strip()}"
                yield SourceRecord(
                    source=source,
                    source_record_id=row["id"],
                    name=name,
                    address=address,
                    latitude=lat,
                    longitude=lon,
                )
                n += 1
                if limit and n >= limit:
                    return


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 統合母集団を EntityResolver で確定する")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr
    )

    records = list(load_records(args.limit or None))
    print(f"入力 source records: {len(records):,}", file=sys.stderr)

    resolver = EntityResolver()
    started = time.time()
    n_links = 0
    # #1273 【設計】住所文字列が無いことの影響を推測で語らず、数字で押さえる。
    # entity_resolution.py の address は**統合の門ではなく順位づけにしか使われない**
    # (`_rank_candidates` の gate は距離と名前のみ、address_score は sort key と
    #  `_select_unambiguous` の near-tie 判定だけ)。したがって住所欠落で増える seed は
    # `ambiguous_new_seed`（候補は在ったが一意に決められなかった）に限られる。
    # その件数が「住所があれば救えたかもしれない上限」になる。
    methods: dict[str, int] = {}

    def count_link(link) -> None:
        nonlocal n_links
        n_links += 1
        methods[link.match_method] = methods.get(link.match_method, 0) + 1

    seeds = resolver.resolve_stream(records, on_link=count_link, presorted=False)
    elapsed = time.time() - started

    print(f"\n=== EntityResolver の結果 ===", file=sys.stderr)
    print(f"  source records : {len(records):,}", file=sys.stderr)
    print(f"  seed（実店舗）  : {len(seeds):,}", file=sys.stderr)
    print(f"  link           : {n_links:,}", file=sys.stderr)
    print(f"  圧縮率         : {len(seeds) / len(records) * 100:.2f}%", file=sys.stderr)
    print(f"  所要           : {elapsed:.1f}s", file=sys.stderr)
    print(f"  method 内訳    : {dict(sorted(methods.items(), key=lambda kv: -kv[1]))}",
          file=sys.stderr)

    # #1273 【設計】最終表に残った唯一の幅（他経路の合算 33.5%〜48.0%）を詰める。
    # 48.0% は Overture 母集団の600店標本で測った値なので、Overture を含まない seed
    # （＝IFAS/OSMだけが知っている店）に他経路が届くかどうかが幅の正体。
    # IFAS の fixture は websites/socials が全行 0 なので、その seed には
    # 「店舗自社サイト」も「socials」も**出発点そのものが無い**。それを数える。
    composition: dict[str, int] = {}
    without_overture = 0
    for seed in seeds:
        key = "+".join(sorted(seed.source_names)) or "(none)"
        composition[key] = composition.get(key, 0) + 1
        if "overture" not in seed.source_names:
            without_overture += 1
    print(
        f"\n=== seed のソース構成 ===\n"
        f"  {dict(sorted(composition.items(), key=lambda kv: -kv[1]))}",
        file=sys.stderr,
    )
    print(
        f"  Overture を含まない seed: {without_overture:,} "
        f"({without_overture / len(seeds) * 100:.2f}%)\n"
        f"  → この層には Overture の websites/socials が無い。IFAS の fixture は\n"
        f"    websites/socials が全行0、OSM も socials 1.12% / websites 7.83% しかないので、\n"
        f"    店舗自社サイト経路も Meta 経路も**出発点が無い**。",
        file=sys.stderr,
    )

    ambiguous = methods.get("ambiguous_new_seed", 0)
    print(
        f"\n住所欠落で救えなかった上限（ambiguous_new_seed）: {ambiguous:,}\n"
        f"  → 住所が完全に揃っていても、母集団が減りうるのは最大 {ambiguous:,} 件。"
        f"下限は {len(seeds) - ambiguous:,}。",
        file=sys.stderr,
    )

    result = {
        "source_records": len(records),
        "seeds": len(seeds),
        "links": n_links,
        "methods": methods,
        "ambiguous_new_seed": ambiguous,
        "seeds_lower_bound_if_address_present": len(seeds) - ambiguous,
        "seed_composition": composition,
        "seeds_without_overture": without_overture,
        "elapsed_s": elapsed,
        "limit": args.limit,
    }

    if not args.limit:
        coverage = META_REACHABLE / len(seeds) * 100
        print(f"\n=== 分母が定まった ===", file=sys.stderr)
        print(f"  統合母集団（seed）: {len(seeds):,}", file=sys.stderr)
        print(f"  Meta 到達 {META_REACHABLE:,} / seed = **{coverage:.2f}%**", file=sys.stderr)
        print(
            f"  オーナー要求 {OWNER_TARGET_PCT:.0f}% に対して: "
            f"{'届く' if coverage >= OWNER_TARGET_PCT else '届かない'}",
            file=sys.stderr,
        )
        coverage_upper = META_REACHABLE / max(len(seeds) - ambiguous, 1) * 100
        print(
            f"  住所が完全に揃っていた場合の上振れ余地: 最大 {coverage_upper:.2f}%",
            file=sys.stderr,
        )
        print(
            "\n※ fixture に住所文字列が無く region+locality で代用している。ただし "
            "entity_resolution.py の address は**統合の門ではなく順位づけにしか使われない**"
            "ため、欠落の影響は ambiguous_new_seed に限られる（上の数字）。",
            file=sys.stderr,
        )
        result["meta_reachable"] = META_REACHABLE
        result["meta_coverage_pct"] = coverage
        result["meta_coverage_pct_upper"] = coverage_upper
        result["owner_target_pct"] = OWNER_TARGET_PCT

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "seed_population.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
