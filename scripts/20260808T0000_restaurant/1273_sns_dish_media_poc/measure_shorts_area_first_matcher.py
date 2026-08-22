#!/usr/bin/env python3
"""#1345 【打開策の実装】地名を先に確定してから店名を照合する

## なぜ

Shorts の題名 40 本を目視したところ、**人間なら 75.0%（30/40）で店を名指しできた**のに
機械は **6.94%（15/216）** しか当てられていない。**差は 68.1pt。**
オーナーの「詰まっているのは店舗特定のところだ」という見立ては当たっていた。

落ちている理由は具体的だった。現行の `NameMatcher` は

    ・4字未満の名前を落とす（81,337 件）
    ・同名が2箇所以上ある名前を落とす（54,147 件）

という規則を持つ。だから『界』『大番』『鶴丸』『七幸』『欽山』『やぐら』は
**辞書に載っていないので当たりようがない**。

この厳しい規則は、**リンク無し層の盲目的な検索（r_N）で偽陽性が 11 倍に
膨らんだ**ことへの対策として入れたものである。しかし Shorts の題名は

    「高松市瓦町 中華そば欽山」「札幌市中央区大通西15丁目」「【札幌市西区】…八軒苑」

のように **地名がほぼ必ず明示されている**。r_N の盲目検索とは前提が違う。
**地名で先に絞れば、短い名前や全国に同名がある名前も一意にできるはず**である。

## この実装

  1. 母集団から「地名 → その地域の店名」の索引を作る（locality 1,498 / region 47）
  2. 題名から**最長一致で地名を取る**（locality → 市名コア → region の順）
  3. その地域の中だけで店名を照合する。**4字未満も同名も落とさない**。
     ただし **その地域内で一意** であることは要求する（絞った意味が無くなるため）

## 評価のしかた

`out/shorts_title_human_ceiling_labels.json` の 40 本（**先に目視ラベルを付けてある**）に
対して recall を測る。ラベルは抽出器を書く前に付けたので、後付けの調整は入っていない。

## この実装が言えないこと

  - **経路存在率の側**の改善である。権利処理（規約・許諾）は別問題
  - 「特定できた店」が母集団のどれだけを覆うかは別の測定（**重複が多い**）
  - 一意性を地域内に緩めた分、**偽陽性は必ず増える**。目視で確かめること

実行:
    python3 measure_shorts_area_first_matcher.py --eval-labels
    python3 measure_shorts_area_first_matcher.py --pool out/shorts_identification_pool.json
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

# 料理カテゴリ語・一般語は地域を絞っても誤爆するので、名前側から落とす。
STOP = {"ラーメン", "らーめん", "うどん", "そば", "寿司", "すし", "焼肉", "カレー",
        "定食", "居酒屋", "食堂", "喫茶", "カフェ", "レストラン", "バー", "パン",
        "中華", "和食", "洋食", "焼鳥", "焼き鳥", "とんかつ", "天ぷら", "餃子",
        "海鮮丼", "牛丼", "丼", "ランチ", "ディナー", "テイクアウト", "グルメ",
        "本店", "支店", "新店", "駅前", "店舗", "予約", "限定", "名店", "人気"}
NOISE = re.compile(r"[#＃][^\s#＃]*")


class AreaIndex:
    def __init__(self) -> None:
        # locality -> name -> 件数（同一 locality に同名が何件あるか）
        self.by_loc: dict[str, collections.Counter] = collections.defaultdict(
            collections.Counter)
        self.by_reg: dict[str, collections.Counter] = collections.defaultdict(
            collections.Counter)
        self.link: dict[tuple[str, str], bool] = {}
        csv.field_size_limit(10**7)
        rows = 0
        for fn in SOURCES:
            p = FIXTURES / fn
            if not p.exists():
                continue
            with p.open(encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    nm = (r.get("name") or "").strip()
                    loc = (r.get("locality") or "").strip()
                    reg = (r.get("region") or "").strip()
                    if len(nm) < 2 or nm in STOP:
                        continue
                    rows += 1
                    if loc:
                        self.by_loc[loc][nm] += 1
                    if reg:
                        self.by_reg[reg][nm] += 1
                    has = int(r.get("n_websites") or 0) + int(r.get("n_socials") or 0)
                    self.link[(nm, loc)] = has > 0
        # 地名の抽出辞書。長いものから当てる。
        self.places: list[tuple[str, str, str]] = []      # (surface, kind, key)
        for loc in self.by_loc:
            self.places.append((loc, "locality", loc))
            core = re.sub(r"(市|区|町|村)$", "", loc)
            if len(core) >= 2 and core != loc and "市" not in core:
                self.places.append((core, "locality_core", loc))
        for reg in self.by_reg:
            self.places.append((reg, "region", reg))
            core = re.sub(r"(都|道|府|県)$", "", reg)
            if len(core) >= 2:
                self.places.append((core, "region_core", reg))
        self.places.sort(key=lambda t: -len(t[0]))
        print(f"[area] {rows:,} 行 / locality {len(self.by_loc):,} / "
              f"region {len(self.by_reg):,} / 地名表記 {len(self.places):,}",
              file=sys.stderr)

    def find_place(self, text: str):
        for surf, kind, key in self.places:
            if surf in text:
                return surf, kind, key
        return None

    def match(self, title: str):
        t = NOISE.sub(" ", title)
        pl = self.find_place(title)          # 地名はハッシュタグ内でも有効
        if not pl:
            return None
        surf, kind, key = pl
        table = self.by_loc[key] if kind.startswith("locality") else self.by_reg[key]
        best = None
        for nm, cnt in table.items():
            if nm in t and (best is None or len(nm) > len(best[0])):
                # **その地域内で一意**であることを要求する
                if cnt == 1:
                    best = (nm, cnt)
        if not best:
            return None
        return {"store": best[0], "place": surf, "place_kind": kind, "area": key,
                "link": self.link.get((best[0], key))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-labels", action="store_true")
    ap.add_argument("--pool")
    args = ap.parse_args()
    idx = AreaIndex()

    if args.eval_labels:
        lab = json.loads((OUT_DIR / "shorts_title_human_ceiling_labels.json")
                         .read_text(encoding="utf-8"))
        ok = lab["examples_ok"]
        ng = lab["examples_ng"]
        hit, rows = 0, []
        print("\n=== 人間が『可』とした 30 本に対する recall ===", file=sys.stderr)
        for e in ok:
            m = idx.match(e["title"])
            got = m["store"] if m else None
            good = bool(got and (got in e["store"] or e["store"] in got))
            hit += good
            rows.append({"title": e["title"], "human": e["store"], "machine": got,
                         "ok": good, "place": m["place"] if m else None})
            print(f"  {'○' if good else '×'} 人間={e['store'][:22]:24} "
                  f"機械={str(got)[:22]:24} 地名={m['place'] if m else '-'}",
                  file=sys.stderr)
        fp = 0
        print("\n=== 人間が『不可』とした 10 本（当ててはいけない）===", file=sys.stderr)
        for e in ng:
            m = idx.match(e["title"])
            if m:
                fp += 1
                print(f"  × 誤爆 {m['store']}（地名 {m['place']}）  ← {e['title'][:40]}",
                      file=sys.stderr)
        print(f"\n  recall **{hit}/{len(ok)} = {hit/len(ok)*100:.1f}%**"
              f"  / 『不可』への誤爆 **{fp}/{len(ng)}**", file=sys.stderr)
        print(f"  現行の基準線は 6.94%（母数が違うので直接は比べられない）", file=sys.stderr)
        p = OUT_DIR / "shorts_area_first_eval.json"
        p.write_text(json.dumps({"recall": hit / len(ok), "hit": hit, "n_ok": len(ok),
                                 "fp_on_ng": fp, "n_ng": len(ng), "rows": rows},
                                ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n-> {p.name}", file=sys.stderr)

    if args.pool:
        pool = json.loads(Path(args.pool).read_text(encoding="utf-8"))
        rows = pool["rows"]
        hits = []
        for r in rows:
            m = idx.match(r["title"])
            if m:
                hits.append({**r, **m})
        n = len(rows)
        print(f"\n=== 収集した Shorts への適用（n={n}）===", file=sys.stderr)
        print(f"  特定できた **{len(hits)}/{n} = {len(hits)/n*100:.2f}%**", file=sys.stderr)
        d = len({h["store"] for h in hits})
        print(f"  distinct 店 **{d}**  / 1本あたり {d/max(len(hits),1):.2f}", file=sys.stderr)
        nl = sum(1 for h in hits if h.get("link") is False)
        print(f"  うちリンク無し層 {nl}/{len(hits)} = "
              f"{nl/max(len(hits),1)*100:.1f}%", file=sys.stderr)
        p = OUT_DIR / "shorts_area_first_pool.json"
        p.write_text(json.dumps({"n": n, "n_hits": len(hits),
                                 "rate": len(hits) / n, "distinct_stores": d,
                                 "n_nolink": nl, "hits": hits[:600],
                                 "caveat": "**経路存在率**である。目視で precision を"
                                           "確かめるまで、この率は使えない。"},
                                ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
