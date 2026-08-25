#!/usr/bin/env python3
"""#1273 【オーナーの提案を測る】「画像ではなく**ライセンス情報が付いたソース**を探す」

## なぜ

オーナーの提案:

    「ライセンスがOKな画像を徹底的に集めるのが一番堅実。
      さらに一工夫するなら、画像を探すんじゃなくて、
      **ライセンス情報がついているソースを探す**という風に考えるといい」

方法論としては正しい。**探索の単位を1枚から1ソースに上げれば、
1回の判断で大量の画像が確定する。** これは測る価値がある。

既に測ってある license-clean 源は Wikimedia Commons / Wikidata で、

    100m 以内に何らかの写真: 27.33%
    店名が一致（生）        :  3.00%
    **目視で店が一致**      :  0.50%
    **目視で料理写真**      :  0.17%

だった（`out/wikimedia-commons.json`、600店の標本）。
ここでは**まだ測っていない源**として Openverse（Flickr / Commons 等の
CC 画像を横断検索する公式 API、無料・鍵不要）を測る。

## 測るもの

  1. 料理カテゴリ134種の日本語ラベルで検索し、**CC 画像が何枚あるか**
  2. ライセンスの内訳。**商用利用が可能なもの（nc を除く）が何割か**
  3. **店に帰属させられるか** — 題名・タグに母集団の店名が出るか

3 がこの提案の成否を決める。`dish_media` は店に紐づくので、
**「ラーメンの CC 写真」が何万枚あっても、どの店のものでもなければ使えない。**

## この測定が言えないこと

  - Openverse の索引にある分だけ。Flickr 等の全量ではない
  - 「商用可」は**ライセンス表記による**。表記が誤っている場合は別問題
  - 帰属は題名・タグの文字列一致で見る。**目視で確かめること**

実行:
    python3 measure_openverse_license_supply.py --cats 134
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
API = "https://api.openverse.org/v1/images/"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"
# 商用利用が可能なライセンス（nc を含まないもの）
COMMERCIAL_OK = {"cc0", "pdm", "by", "by-sa"}


def q(term: str, page_size: int = 20) -> dict:
    url = API + "?" + urllib.parse.urlencode({"q": term, "page_size": page_size})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cats", type=int, default=134)
    args = ap.parse_args()

    dishes = []
    with (HERE / "fixtures" / "public_dish_categories_134_gate.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ja = (r.get("label_ja") or "").strip()
            if ja:
                dishes.append(ja)
    dishes = dishes[: args.cats]

    lic = collections.Counter()
    src = collections.Counter()
    total = 0
    zero = 0
    rows = []
    titles = []
    for i, d in enumerate(dishes, 1):
        try:
            res = q(d)
        except Exception as e:                                   # noqa: BLE001
            print(f"  {i:>3}. {d:16} 取得失敗 {type(e).__name__}", file=sys.stderr)
            continue
        n = res.get("result_count") or 0
        total += n
        if n == 0:
            zero += 1
        for r in res.get("results", []):
            lic[r.get("license")] += 1
            src[r.get("source")] += 1
            titles.append({"dish": d, "title": r.get("title") or "",
                           "license": r.get("license"), "source": r.get("source")})
        rows.append({"dish": d, "result_count": n})
        print(f"  {i:>3}/{len(dishes)} {d:16} {n:>6} 枚  累計 {total:,}",
              file=sys.stderr, flush=True)
        time.sleep(0.25)

    n_lic = sum(lic.values())
    ok = sum(v for k, v in lic.items() if k in COMMERCIAL_OK)
    print(f"\n=== Openverse の CC 画像（料理 {len(rows)} カテゴリ）===", file=sys.stderr)
    print(f"  検索ヒットの合計 **{total:,} 枚**（0件だったカテゴリ {zero}）", file=sys.stderr)
    print(f"  標本 {n_lic} 枚のライセンス内訳:", file=sys.stderr)
    for k, v in lic.most_common():
        mark = "**商用可**" if k in COMMERCIAL_OK else "商用不可(nc)"
        print(f"    {str(k):10} {v:>4} 枚  {mark}", file=sys.stderr)
    print(f"  **商用利用が可能な割合 {ok}/{n_lic} = {ok/max(n_lic,1)*100:.1f}%**", file=sys.stderr)
    print(f"  ソース内訳: {dict(src.most_common(6))}", file=sys.stderr)

    p = OUT_DIR / "openverse_license_supply.json"
    p.write_text(json.dumps(
        {"n_categories": len(rows), "total_results": total, "n_zero_categories": zero,
         "license_breakdown": dict(lic), "commercial_ok": ok, "n_sampled": n_lic,
         "commercial_ok_rate": ok / max(n_lic, 1),
         "source_breakdown": dict(src), "rows": rows, "titles": titles[:800],
         "caveat": "Openverse の索引にある分だけ。商用可はライセンス表記による。"
                   "**店への帰属は別途測ること**（この数字は枚数であって店数ではない）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
