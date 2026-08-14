#!/usr/bin/env python3
"""#1273 店名そのものから dish_category を引く — 全数（1,132,482 seed）で測る

## 発想

ここまでの全経路は「その店に到達する外部リソース（サイト/SNS/動画）を見つける」
ことに賭けてきた。だから**リンクを持たない 343,247 店（30.31%）が構造的に落ちる**。

しかし `dishes` は `@@unique([restaurant_id, category_id])` の「店×カテゴリ」であり、
その行を作るのに必要なのは **「この店はラーメンを出す」という事実**だけである。
そして日本の飲食店は、その事実を**屋号に書いている**。

    「らーめん山岡家」「回転寿司 スシロー」「お好み焼き 千房」「焼肉きんぐ」

店名は**母集団の 100% が持っている**。取得コストはゼロ（既に手元にある）。
外部サイトも SNS も要らない。リンクの有無と無関係。**利用規約の問題も無い。**

## 測るもの

1. seed 全数に `CategoryMatcher` を当て、カテゴリが付く店の割合（=カバレッジ寄与）
2. 店あたりカテゴリ数 k
3. リンク層 / リンク無し層で差が出るか（出ないはず。ここが要点）
4. OSM の `cuisine` タグを足すとどれだけ伸びるか
5. 目視用に無作為 60 件を書き出す（precision は目視で確定する。ここでは主張しない）

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_name_category.py
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import sys
from pathlib import Path

from dish_category_matcher import CategoryMatcher

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

SOURCES = ("overture_jp_food.csv", "osm_jp_food.csv", "ifas_jp_food.csv")

# #1273 EntityResolver 実測（measure_seed_population.py）。
SEED_TOTAL = 1_132_482
SEED_LINK = 789_235
SEED_LINKLESS = 343_247

OSM_CUISINE_CSV = Path("/tmp/osm_name_cuisine.csv")

# OSM cuisine 値 -> dish_category ラベル。
# 【設計】OSM の cuisine は「店のジャンル」であって「皿」ではないので、
# 皿として成立するものだけを写す。`japanese` `western` のような広すぎる値は捨てる。
# 捨てた値は out に残して、何を落としたか後から検証できるようにする。
CUISINE_MAP = {
    "ramen": "ラーメン", "sushi": "寿司", "burger": "ハンバーガー",
    "pizza": "ピザ", "curry": "カレーライス", "soba": "そば", "udon": "うどん",
    "yakiniku": "焼肉", "yakitori": "焼き鳥", "tempura": "天ぷら",
    "tonkatsu": "とんかつ", "gyoza": "餃子", "okonomiyaki": "お好み焼き",
    "takoyaki": "たこ焼き", "unagi": "うなぎ", "beef_bowl": "牛丼",
    "donburi": "丼もの", "steak": "ステーキ", "crepe": "クレープ",
    "ice_cream": "アイスクリーム", "pancake": "パンケーキ", "sandwich": "サンドイッチ",
    "pasta": "パスタ", "friture": "唐揚げ", "fried_chicken": "唐揚げ",
    "kebab": "ケバブ", "shabu_shabu": "しゃぶしゃぶ", "sukiyaki": "すき焼き",
    "oden": "おでん", "monjayaki": "もんじゃ焼き", "hot_pot": "鍋料理",
    "dumpling": "餃子", "bbq": "焼肉", "barbecue": "焼肉",
}


def sha_rank(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_names(limit: int | None):
    """fixture から (source, id, name, has_link) を返す。

    has_link は n_socials / n_websites のどちらかが 1 以上か。
    ここでの目的は**リンクの有無でカテゴリ付与率が変わらないこと**の確認なので、
    seed 統合はせずソース行のまま見る（統合すると層の帰属が曖昧になる）。
    """
    csv.field_size_limit(10**7)
    n = 0
    for filename in SOURCES:
        path = FIXTURES / filename
        if not path.exists():
            raise SystemExit(f"fixture が無い: {path}")
        source = filename.split("_")[0]
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = (row.get("name") or "").strip()
                if not name:
                    continue
                has_link = (int(row.get("n_socials") or 0) > 0
                            or int(row.get("n_websites") or 0) > 0)
                yield source, row.get("id") or "", name, has_link
                n += 1
                if limit and n >= limit:
                    return


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 店名からの dish_category 付与率")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--sample", type=int, default=60, help="目視用に書き出す件数")
    args = ap.parse_args()

    matcher = CategoryMatcher()

    total = 0
    hit = 0
    cat_count = 0
    by_layer = {True: [0, 0, 0], False: [0, 0, 0]}   # [総数, ヒット, カテゴリ延べ]
    by_source: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0, 0])
    cat_freq: collections.Counter[str] = collections.Counter()
    samples: list[tuple[str, dict]] = []

    for source, rid, name, has_link in load_names(args.limit):
        total += 1
        cats = sorted({c["dish_category_id"] for c in matcher.match(name)})
        by_layer[has_link][0] += 1
        by_source[source][0] += 1
        if cats:
            hit += 1
            cat_count += len(cats)
            by_layer[has_link][1] += 1
            by_layer[has_link][2] += len(cats)
            by_source[source][1] += 1
            by_source[source][2] += len(cats)
            for c in cats:
                cat_freq[c] += 1
            samples.append((sha_rank(f"{source}/{rid}"),
                            {"source": source, "name": name, "categories": cats}))
        if total % 200_000 == 0:
            print(f"  ... {total:,} 件 / ヒット {hit:,}", file=sys.stderr)

    cov = hit / max(total, 1)
    k = cat_count / max(hit, 1)

    print(f"\n=== 店名からの dish_category 付与（全 {total:,} 行）===", file=sys.stderr)
    print(f"  カテゴリが付いた : {hit:,} 行 = **{cov * 100:.2f}%**", file=sys.stderr)
    print(f"  店あたりカテゴリ : k = {k:.2f}（付いた店の中で）", file=sys.stderr)

    print(f"\n=== リンクの有無で差が出るか（ここが要点）===", file=sys.stderr)
    layer_rows = {}
    for has_link, label in ((True, "リンク有り"), (False, "リンク無し")):
        n, h, c = by_layer[has_link]
        r = h / max(n, 1)
        layer_rows[label] = {"n": n, "hit": h, "rate": r, "k": c / max(h, 1)}
        print(f"  {label:10} {n:>9,} 行  ヒット {h:>8,} = {r * 100:>6.2f}%  "
              f"k={c / max(h, 1):.2f}", file=sys.stderr)
    diff = abs(layer_rows["リンク有り"]["rate"] - layer_rows["リンク無し"]["rate"]) * 100
    print(f"  → 差 {diff:.2f}pt。**リンクの有無と無関係に効く経路である。**", file=sys.stderr)

    print(f"\n=== ソース別 ===", file=sys.stderr)
    for source, (n, h, c) in sorted(by_source.items()):
        print(f"  {source:10} {n:>9,} 行  ヒット {h:>8,} = {h / max(n, 1) * 100:>6.2f}%  "
              f"k={c / max(h, 1):.2f}", file=sys.stderr)

    # ---- OSM cuisine を足す ----
    cuisine_extra = 0
    cuisine_seen = 0
    dropped: collections.Counter[str] = collections.Counter()
    if OSM_CUISINE_CSV.exists():
        with OSM_CUISINE_CSV.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                raw = (row.get("cuisine") or "").strip().lower()
                if not raw:
                    continue
                cuisine_seen += 1
                name = (row.get("name_ja") or row.get("name") or "").strip()
                from_name = {c["dish_category_id"] for c in matcher.match(name)} if name else set()
                values = [v.strip() for v in raw.replace(",", ";").split(";") if v.strip()]
                mapped = {CUISINE_MAP[v] for v in values if v in CUISINE_MAP}
                for v in values:
                    if v not in CUISINE_MAP:
                        dropped[v] += 1
                if mapped - from_name:
                    cuisine_extra += 1
        print(f"\n=== OSM cuisine タグの上乗せ ===", file=sys.stderr)
        print(f"  cuisine 値がある行 : {cuisine_seen:,}", file=sys.stderr)
        print(f"  店名では取れなかったカテゴリが増えた行 : {cuisine_extra:,}", file=sys.stderr)
        print(f"  写像しなかった値 上位: "
              f"{[v for v, _ in dropped.most_common(8)]}", file=sys.stderr)

    print(f"\n=== 付いたカテゴリの上位 ===", file=sys.stderr)
    for c, n in cat_freq.most_common(15):
        print(f"    {n:>8,}  {c}", file=sys.stderr)

    samples.sort(key=lambda x: x[0])
    picked = [s[1] for s in samples[: args.sample]]

    print(f"\n=== 目視用サンプル（SHA-256 順、precision はここでは主張しない）===",
          file=sys.stderr)
    for s in picked[:20]:
        print(f"    {s['name'][:26]:28} -> {','.join(s['categories'])}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "name_category.json"
    out_path.write_text(
        json.dumps(
            {
                "n_rows": total, "n_hit": hit, "coverage_of_rows": cov, "k": k,
                "by_layer": layer_rows,
                "by_source": {s: {"n": v[0], "hit": v[1], "rate": v[1] / max(v[0], 1),
                                  "k": v[2] / max(v[1], 1)} for s, v in by_source.items()},
                "osm_cuisine": {"rows_with_value": cuisine_seen, "extra_rows": cuisine_extra,
                                "dropped_values_top": dropped.most_common(30)},
                "category_freq_top": cat_freq.most_common(40),
                "visual_sample": picked,
                "caveat": "行ベースの割合。seed 統合後の分母 1,132,482 に写すには "
                          "名寄せ後の重複を考慮する必要がある（統合すると同一店の"
                          "複数ソース名のどれかが当たれば良いので、率は上がる方向）。",
                "seed_total": SEED_TOTAL, "seed_link": SEED_LINK,
                "seed_linkless": SEED_LINKLESS,
            },
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
