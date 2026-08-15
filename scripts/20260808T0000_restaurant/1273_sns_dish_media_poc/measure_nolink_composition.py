#!/usr/bin/env python3
"""#1273 リンク無し 343,247 店の中身は何か

## なぜ

到達可能性の恒等式（前節）で、**リンク無し層は要求 70% に数学的に必須**だと確定した
（リンク有りは 69.69% しか無いので、そこを 100% 埋めても 0.31pt 足りない）。
必須だと分かった以上、**その層に何が入っているのか**を一度見ておく必要がある。

リンク無し層の 60.3% は IFAS（営業許可施設）由来である。IFAS は
**食品衛生法の営業許可の台帳**であって、消費者向けの飲食店の一覧ではない。
給食施設・食品製造業・移動販売・自動販売機なども同じ台帳に載りうる。

**もし相当数が「料理写真を撮れる消費者向け店舗」でないなら、分母そのものの話になる。**
これは要求を下げる提案ではない。**分母が何かを実測する**という話である。

## 測り方

リンク無し行から SHA-256 順に決定的に 60 件を抜き、屋号・ソース・basic_category を
並べて目視で分類する。加えて、屋号に出る**施設の型を示す語**を全数で数える
（給食/食堂センター/学校/病院/工場/製造/移動販売/自販機 …）。

語彙は手書きなので**下限**である。目視標本の方が実態に近い。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_nolink_composition.py --sample 60
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

# 消費者向けの飲食店では**ない**ことを示唆する語（手書き＝下限）
NON_RETAIL = {
    "給食": re.compile(r"給食"),
    "学校・保育": re.compile(r"小学校|中学校|高等学校|保育園|幼稚園|こども園|学園|大学"),
    "病院・福祉": re.compile(r"病院|医院|クリニック|老人|特別養護|介護|福祉|診療所"),
    "製造・加工": re.compile(r"製造|加工|工場|製パン|製麺|製菓|食品工業|プラント"),
    "移動販売・仕出し": re.compile(r"移動販売|キッチンカー|仕出し|弁当製造|配達専門"),
    "社員食堂・寮": re.compile(r"社員食堂|職員食堂|社宅|寮|事業所"),
    "宿泊": re.compile(r"ホテル|旅館|民宿|ペンション|国民宿舎|山荘"),
    "小売・卸": re.compile(r"スーパー|マーケット|商店|酒販|卸|問屋|直売"),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=60)
    args = ap.parse_args()
    csv.field_size_limit(10**7)

    rows = []
    for fn in SOURCES:
        p = FIXTURES / fn
        if not p.exists():
            continue
        src = fn.split("_")[0]
        with p.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                has = (int(r.get("n_socials") or 0) > 0
                       or int(r.get("n_websites") or 0) > 0)
                if has:
                    continue
                rows.append({"name": name, "source": src,
                             "cat": (r.get("basic_category") or "").strip(),
                             "loc": (r.get("locality") or "").strip(),
                             "id": r.get("id") or ""})
    print(f"リンク無し行 {len(rows):,}", file=sys.stderr)
    by_src = collections.Counter(r["source"] for r in rows)
    print(f"  ソース別: {dict(by_src)}", file=sys.stderr)

    print(f"\n=== 屋号に出る「消費者向けでない」型（手書き語彙・下限）===", file=sys.stderr)
    hits = collections.Counter()
    tagged = {}
    for i, r in enumerate(rows):
        for k, rx in NON_RETAIL.items():
            if rx.search(r["name"]):
                hits[k] += 1
                tagged[i] = k
                break
    for k, c in hits.most_common():
        print(f"  {k:16} {c:>7,} = {c/len(rows)*100:>5.2f}%", file=sys.stderr)
    print(f"  {'合計':16} {len(tagged):>7,} = {len(tagged)/len(rows)*100:>5.2f}%",
          file=sys.stderr)

    print(f"\n=== basic_category の内訳（上位10）===", file=sys.stderr)
    for c, n in collections.Counter(r["cat"] for r in rows).most_common(10):
        print(f"  {c or '(空)':28} {n:>7,} = {n/len(rows)*100:>5.2f}%", file=sys.stderr)

    ordered = sorted(rows, key=lambda r: hashlib.sha256(
        f"{r['source']}/{r['id']}".encode()).hexdigest())[: args.sample]
    print(f"\n=== 決定的標本 {len(ordered)} 件（SHA-256順・目視で分類する）===",
          file=sys.stderr)
    for i, r in enumerate(ordered, 1):
        print(f"{i:>3}. [{r['source']:8}] {r['name'][:40]:42} {r['cat'][:16]:18} "
              f"{r['loc'][:12]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "nolink_composition.json"
    p.write_text(json.dumps(
        {"n_nolink_rows": len(rows), "by_source": dict(by_src),
         "non_retail_vocab_hits": dict(hits),
         "non_retail_total": len(tagged),
         "non_retail_pct": len(tagged) / len(rows) * 100,
         "sample": ordered,
         "caveat": "語彙は手書きなので下限。分母の中身を実測するのが目的で、"
                   "要求を下げる提案ではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
