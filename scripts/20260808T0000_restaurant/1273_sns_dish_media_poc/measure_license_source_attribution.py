#!/usr/bin/env python3
"""#1273 ライセンス付きソースは**店に帰属するのか**（オーナー提案の成否を決める1点）

## なぜ

「ライセンス情報が付いたソースを探す」という方針は方法論として正しい。
実際、**料理**の単位で見ればライセンス済みの画像は大量にある。

    Wikimedia Commons（実測 totalhits）
      ラーメン 27,743 / 寿司 24,559 / うどん 4,408 / 焼肉 3,030
      "Japanese food" 88,917

だが `dish_media` は**店に紐づく**。「ラーメンの CC 写真が 27,743 枚ある」ことと
「**この店の**ラーメン写真がある」ことは別である。**そこを測る。**

既測（`out/wikimedia-commons.json`、600店の標本）:

    100m 以内に何らかの写真   27.33%
    店名が一致（生）           3.00%
    **目視で店が一致**         0.50%
    **目視で料理写真**         0.17%

ここでは Openverse（Flickr/Commons 横断、無料・鍵不要）の題名に対して
同じことを測り、**源を変えても結論が変わらないか**を見る。

## この測定が言えないこと

  - Openverse の `result_count` は **どの検索でも 240 で頭打ち**（`cat` でも 240）。
    **枚数の指標としては使えない**ので、枚数は Commons の `totalhits` を使う
  - 題名の文字列一致で見る。目視で確かめること

実行:
    python3 measure_license_source_attribution.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
COMMONS_TOTALHITS = {"ラーメン": 27_743, "寿司": 24_559, "うどん": 4_408,
                     "焼肉": 3_030, "カレーライス": 2_183, "Japanese food": 88_917}
WIKIMEDIA_STORE_VERIFIED = 0.0050      # out/wikimedia-commons.json
WIKIMEDIA_DISH_VERIFIED = 0.0017


def main() -> None:
    d = json.loads((OUT_DIR / "openverse_license_supply.json").read_text(encoding="utf-8"))
    m = NameMatcher()
    dic = set(m.auto_ja.keys()) | set(m.auto_la.keys())

    # #1273 【バグ】最初は辞書 745,309 件を題名ごとに総なめしていた。
    #   2,610 題名 × 74万 = 19億回で終わらない。**オートマトンを使う**。
    titles = d["titles"]
    hits = []
    for t in titles:
        s = t["title"]
        got = None
        for _, nm in m.auto_ja.iter(s):
            if len(nm) >= 4 and (got is None or len(nm) > len(got)):
                got = nm
        if got is None:
            for _, nm in m.auto_la.iter(s):
                if len(nm) >= 5 and (got is None or len(nm) > len(got)):
                    got = nm
        if got:
            hits.append({**t, "store": got})
    n = len(titles)
    print("=== ライセンス付き画像は店に帰属するか ===", file=sys.stderr)
    print(f"  Openverse の題名 {n} 件のうち、店名辞書に当たったもの "
          f"**{len(hits)}/{n} = {len(hits)/max(n,1)*100:.2f}%**", file=sys.stderr)
    for h in hits[:12]:
        print(f"    {h['store']:14} ← {h['title'][:56]!r}", file=sys.stderr)

    ok = d["commercial_ok"]; ns = d["n_sampled"]
    print(f"\n  商用利用が可能なライセンス **{ok}/{ns} = {ok/max(ns,1)*100:.1f}%**",
          file=sys.stderr)
    print(f"  ライセンス内訳 {d['license_breakdown']}", file=sys.stderr)

    print(f"\n=== 枚数は Commons の totalhits で見る（Openverse は 240 で頭打ち）===",
          file=sys.stderr)
    for k, v in COMMONS_TOTALHITS.items():
        print(f"  {k:16} {v:>8,} 枚", file=sys.stderr)

    print(f"\n=== 既測（Wikimedia、600店）===", file=sys.stderr)
    print(f"  目視で店が一致 **{WIKIMEDIA_STORE_VERIFIED*100:.2f}%** / "
          f"目視で料理写真 **{WIKIMEDIA_DISH_VERIFIED*100:.2f}%**", file=sys.stderr)
    print(f"  母集団 1,132,482 店に当てると **約 "
          f"{1_132_482*WIKIMEDIA_DISH_VERIFIED:,.0f} 店**", file=sys.stderr)

    p = OUT_DIR / "license_source_attribution.json"
    p.write_text(json.dumps(
        {"n_titles": n, "n_store_name_in_title": len(hits),
         "rate": len(hits) / max(n, 1),
         "examples": hits[:40],
         "commercial_ok_rate": ok / max(ns, 1),
         "license_breakdown": d["license_breakdown"],
         "commons_totalhits": COMMONS_TOTALHITS,
         "wikimedia_store_verified": WIKIMEDIA_STORE_VERIFIED,
         "wikimedia_dish_verified": WIKIMEDIA_DISH_VERIFIED,
         "caveat": "題名の文字列一致であって目視ではない。Openverse の result_count は"
                   "240 で頭打ちなので枚数には使わない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
