#!/usr/bin/env python3
"""#1273 正しい分母（統合母集団 seed）で、無料経路の天井を測り直す

## なぜこれが決着をつける測定なのか

これまでの天井（33.5%〜48.0%）は全て **Overture 789,612 を分母にした600店標本**で測っていた。
正しい分母は名寄せ後の **1,132,482 seed**（`measure_seed_population.py`）である。

そして分母を正すと、外挿を待たずに1つ確定することがある:

    外部リンク（website / socials）を持ちうる seed = 789,235 = 69.69%

**リンクのある店を100%カバーしても 69.69% で、70% に届かない。**
店舗自社サイト経路も Meta 経路もリンクを起点にするので、
**リンク起点の経路だけでは、どう積んでも 70% は数学的に不可能。**

したがって 70% の可否は「**店名だけを手がかりにできる経路**が、
リンクを持たない 343,247 店にどれだけ届くか」だけで決まる。
YouTube のキーワード検索はリンクの有無に関係なく届くので、そこを実測する。

## やること

1. `EntityResolver` で seed を作り、`overture` を含むか否かで2層に分ける
2. 各層から決定的に標本抽出（SHA-256 順。再実行しても同じ標本）
3. 各店に `ytsearch{depth}:"{店名} {市区町村}"` を投げ、
   `measure_supply_ceiling.py` と**同一の judge** でヒット判定する
   （基準を変えると過去ラウンドと比較できない）
4. 層ごとのヒット率から、統合母集団に対する天井を出す

実行:
    python3 measure_seed_youtube_ceiling.py --per-stratum 150
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from entity_resolution import EntityResolver, SourceRecord  # noqa: E402

from measure_supply_ceiling import (  # noqa: E402
    MIN_NAME_LEN_FOR_SUBSTRING,
    Restaurant,
    core_name,
    judge,
    normalize,
    wilson_interval,
    yt_search,
)


# #1273 【バグ】厳格版の第1版は locality を丸ごと要求していたため測定不能だった。
# seed の canonical_address は "北海道札幌市中央区" のような region+locality の連結で、
# 動画タイトルにその文字列が丸ごと出ることはまず無い。さらにリンク無し層は
# 150店中49店が locality 空で、構造的に必ず不ヒットになっていた。
# 結果 2.67% という数字が出たが、これは実態ではなく測定の不備である。
#
# 修正: 連結文字列から**最も具体的な行政区画トークン**（市/区/町/村）を1つ取り出し、
# それを裏取りの手がかりにする。locality が取れない店は「判定不能」として
# 分母から外す（不ヒットに数えない）。
# 【バグ】最初は [^都道府県市区町村]{1,8}[市区町村] で書いたが、
# 「大府市」の"府"を文字クラスで弾いてしまい空になった。
# 都道府県 → 郡 の順に接頭辞を落としてから、最後の市区町村トークンを取る方式にする。
_PREF = re.compile(r"^.{2,4}?[都道府県]")
_GUN = re.compile(r"^.{1,4}?郡")
_ADMIN_TOKEN = re.compile(r"\S{1,6}?[市区町村]")


def locality_needle(raw: str) -> str:
    """"北海道札幌市中央区" -> "中央区" のように、最も具体的なトークンを返す。"""
    text = _PREF.sub("", raw or "", count=1)
    text = _GUN.sub("", text, count=1)
    tokens = _ADMIN_TOKEN.findall(text)
    return tokens[-1] if tokens else text


def judge_strict(rest, entries: list[dict]) -> dict:
    """#1273 【バグ】既存の judge は**3文字未満の店名にしか地名の裏取りを要求しない**。

    そのせいで「Cockapoo」(犬種) 「マナカムナ」(ネパールの寺院) 「ムーラン」(Disney映画)
    「いじげん」(ポケモン) のような、長いが一般名詞に近い店名が無関係な動画を拾っていた。
    店名検索でヒットした79件を目視した結果、リンク無し層では 23/39 が店と無関係だった
    （精度 41.0%。根拠: out/yt_name_match_review.json）。

    こちらは**全ての店名に地名の裏取りを要求する**。経路存在率は下がるが、
    下がった分は取りこぼしではなく混入の除去である。
    地名が取れない店は判定不能を返す（不ヒットには数えない）。
    """
    nm = normalize(rest.name)
    core = normalize(core_name(rest.name))
    loc = normalize(locality_needle(rest.locality))
    if not loc:
        return {"hit": None, "best_match": None, "n_results": len(entries)}
    best = None
    for e in entries:
        title = normalize(e.get("title") or "")
        channel = normalize(e.get("channel") or e.get("uploader") or "")
        desc = normalize(e.get("description") or "")
        if loc not in title and loc not in desc and loc not in channel:
            continue
        for needle, kind in ((nm, "full_name"), (core, "core_name")):
            if not needle:
                continue
            for field, fname in ((title, "title"), (channel, "channel")):
                if needle in field:
                    best = best or {
                        "video_id": e.get("id"), "title": e.get("title"),
                        "evidence": f"{kind}_in_{fname}_with_{loc}",
                    }
    return {"hit": best is not None, "best_match": best, "n_results": len(entries)}


HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SEED_CACHE = OUT_DIR / "seed_strata_sample.json"

SOURCES = {
    "overture_jp_food.csv": "overture",
    "osm_jp_food.csv": "osm",
    "ifas_jp_food.csv": "ifas",
}

# measure_seed_population.py の実測。
TOTAL_SEEDS = 1_132_482
SEEDS_WITH_OVERTURE = 789_235
SEEDS_WITHOUT_OVERTURE = 343_247
OWNER_TARGET_PCT = 70.0

# Overture 標本で測った既存値（REPORT.md の判定表）。リンク起点の経路の合算。
LINK_ROUTE_CEILING_ON_OVERTURE = 0.480


def build_sample(per_stratum: int) -> dict:
    """seed を作り、overture を含むか否かの2層から決定的に抽出する。"""
    csv.field_size_limit(10**7)
    records = []
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
                records.append(
                    SourceRecord(
                        source=source,
                        source_record_id=row["id"],
                        name=name,
                        address=f"{(row.get('region') or '').strip()}"
                        f"{(row.get('locality') or '').strip()}",
                        latitude=lat,
                        longitude=lon,
                    )
                )
    print(f"source records: {len(records):,}", file=sys.stderr)

    seeds = EntityResolver().resolve_stream(records, on_link=lambda _l: None, presorted=False)
    print(f"seeds: {len(seeds):,}", file=sys.stderr)

    strata: dict[str, list] = {"with_overture": [], "without_overture": []}
    for seed in seeds:
        key = "with_overture" if "overture" in seed.source_names else "without_overture"
        strata[key].append(seed)

    # 決定的サンプリング: 乱数ではなく SHA-256 順で選ぶ（再実行で同じ標本になる）。
    sample: dict[str, list[dict]] = {}
    for key, pool in strata.items():
        pool.sort(key=lambda s: hashlib.sha256(s.seed_id.encode()).hexdigest())
        sample[key] = [
            {
                "seed_id": s.seed_id,
                "name": s.canonical_name,
                # canonical_address は region+locality を繋げたもの。市区町村側だけ欲しいので
                # 検索クエリでは address をそのまま使う（都道府県が混ざっても害は小さい）。
                "locality": s.canonical_address,
                "sources": sorted(s.source_names),
            }
            for s in pool[:per_stratum]
        ]
        print(f"  {key}: 母数 {len(pool):,} -> 標本 {len(sample[key]):,}", file=sys.stderr)

    payload = {
        "strata_population": {k: len(v) for k, v in strata.items()},
        "sample": sample,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SEED_CACHE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 seed 分母での無料経路の天井")
    ap.add_argument("--per-stratum", type=int, default=150)
    ap.add_argument("--depth", type=int, default=8)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--rebuild", action="store_true", help="seed 標本を作り直す（約7分）")
    args = ap.parse_args()

    if args.rebuild or not SEED_CACHE.exists():
        payload = build_sample(args.per_stratum)
    else:
        payload = json.loads(SEED_CACHE.read_text(encoding="utf-8"))
        print(f"seed 標本をキャッシュから読んだ: {SEED_CACHE.name}", file=sys.stderr)

    results: dict[str, list[dict]] = {}
    for stratum, items in payload["sample"].items():
        print(f"\n=== {stratum}: {len(items)} 店に ytsearch{args.depth} ===", file=sys.stderr)
        started = time.time()

        def probe(item: dict) -> dict:
            rest = Restaurant(
                id=item["seed_id"],
                name=item["name"],
                locality=item["locality"],
                latitude=0.0,
                longitude=0.0,
                confidence=0.0,
                tier="",
            )
            query = f"{item['name']} {item['locality']}".strip()
            entries, err = yt_search(query, args.depth)
            verdict = judge(rest, entries)
            strict = judge_strict(rest, entries)
            return {"seed_id": item["seed_id"], "name": item["name"],
                    "sources": item["sources"], "query": query, "error": err,
                    "hit_strict": strict["hit"], "best_match_strict": strict["best_match"],
                    **verdict}

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            results[stratum] = list(pool.map(probe, items))
        ok = [r for r in results[stratum] if r["error"] is None]
        hit = [r for r in ok if r["hit"]]
        # 厳格版は地名が取れない店を判定不能(None)にしているので、分母から外す。
        ok_s = [r for r in ok if r["hit_strict"] is not None]
        hit_s = [r for r in ok_s if r["hit_strict"]]
        print(f"  【厳格版・全店名に地名の裏取りを要求】判定できた {len(ok_s)}/{len(ok)} / "
              f"ヒット {len(hit_s)} "
              f"({len(hit_s) / len(ok_s) * 100 if ok_s else 0:.2f}%)", file=sys.stderr)
        print(
            f"  判定できた {len(ok)}/{len(items)} / ヒット {len(hit)} "
            f"({len(hit) / len(ok) * 100 if ok else 0:.2f}%) / {time.time() - started:.0f}s",
            file=sys.stderr,
        )

    summary = {}
    for stratum, rows in results.items():
        ok = [r for r in rows if r["error"] is None]
        hit = [r for r in ok if r["hit"]]
        rate = len(hit) / len(ok) if ok else 0.0
        lo, hi = wilson_interval(len(hit), len(ok)) if ok else (0.0, 0.0)
        summary[stratum] = {"n_ok": len(ok), "n_hit": len(hit), "rate": rate,
                            "wilson_lo": lo, "wilson_hi": hi}

    print("\n=== 層別 YouTube 経路存在率（店名だけが手がかり）===", file=sys.stderr)
    for stratum, s in summary.items():
        print(
            f"  {stratum:18} {s['n_hit']:>4}/{s['n_ok']:<4} = {s['rate'] * 100:>6.2f}% "
            f"(95%CI {s['wilson_lo'] * 100:.1f}-{s['wilson_hi'] * 100:.1f}%)",
            file=sys.stderr,
        )

    # 統合母集団に対する天井。
    # リンク層はリンク起点の経路(48.0%)と YouTube の和集合だが、和集合の実測が無いので
    # 「リンク層は 100% 取れる」という**最大限甘い仮定**を置く。これで上限が出る。
    yt_linkless = summary.get("without_overture", {}).get("rate", 0.0)
    yt_link = summary.get("with_overture", {}).get("rate", 0.0)

    share_link = SEEDS_WITH_OVERTURE / TOTAL_SEEDS
    share_linkless = SEEDS_WITHOUT_OVERTURE / TOTAL_SEEDS

    ceiling_optimistic = (1.0 * share_link + yt_linkless * share_linkless) * 100
    ceiling_realistic = (
        LINK_ROUTE_CEILING_ON_OVERTURE * share_link + yt_linkless * share_linkless
    ) * 100

    print("\n=== 統合母集団 1,132,482 に対する天井 ===", file=sys.stderr)
    print(f"  リンク層 {share_link * 100:.2f}% / リンク無し層 {share_linkless * 100:.2f}%",
          file=sys.stderr)
    print(
        f"  【最大限甘い仮定】リンク層を100%カバー + リンク無し層に YouTube "
        f"{yt_linkless * 100:.2f}% : **{ceiling_optimistic:.2f}%**",
        file=sys.stderr,
    )
    print(
        f"  【実測ベース】リンク層 48.0% + リンク無し層 YouTube "
        f"{yt_linkless * 100:.2f}% : **{ceiling_realistic:.2f}%**",
        file=sys.stderr,
    )
    print(
        f"\n  オーナー要求 {OWNER_TARGET_PCT:.0f}% に対して: "
        f"{'甘い仮定なら届く' if ceiling_optimistic >= OWNER_TARGET_PCT else '甘い仮定でも届かない'}",
        file=sys.stderr,
    )

    # #1273 【設計】「届かない」で終わらせず、**何が真なら届くのか**を出す。
    # リンク無し層は YouTube の実測値で固定し、リンク層に必要なカバレッジを逆算する。
    required_link = (
        OWNER_TARGET_PCT / 100 - yt_linkless * share_linkless
    ) / share_link
    print(
        f"\n=== 70% に届くための必要条件 ===\n"
        f"  リンク無し層({share_linkless * 100:.2f}%)を YouTube 実測 {yt_linkless * 100:.2f}% で固定すると、\n"
        f"  **リンク層({share_link * 100:.2f}%) を {required_link * 100:.2f}% までカバーする必要がある。**\n"
        f"  現在のリンク層は {LINK_ROUTE_CEILING_ON_OVERTURE * 100:.1f}%（不足 "
        f"{(required_link - LINK_ROUTE_CEILING_ON_OVERTURE) * 100:.1f}pt）。",
        file=sys.stderr,
    )

    out_path = OUT_DIR / "seed_youtube_ceiling.json"
    out_path.write_text(
        json.dumps(
            {
                "strata_population": payload["strata_population"],
                "summary": summary,
                "yt_rate_link_layer": yt_link,
                "yt_rate_linkless_layer": yt_linkless,
                "ceiling_optimistic_pct": ceiling_optimistic,
                "ceiling_realistic_pct": ceiling_realistic,
                "owner_target_pct": OWNER_TARGET_PCT,
                "required_link_layer_coverage_pct": required_link * 100,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
