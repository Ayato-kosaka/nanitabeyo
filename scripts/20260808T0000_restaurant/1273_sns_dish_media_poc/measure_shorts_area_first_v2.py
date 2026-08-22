#!/usr/bin/env python3
"""#1345 【打開策 v2】地名を先に確定し、**店名の芯**で照合する

## v1 で分かった落ち方

v1（`measure_shorts_area_first_matcher.py`）は recall 23.3%（7/30）で止まった。
落ちた 23 本を1件ずつ追ったところ、原因は2つに分かれた。

  **F1 辞書の名前のほうが長い**（直せる）
      題名「高松市瓦町 中華そば欽山」/ 母集団「らぁめん 欽山製麺所」
      題名「福岡…「猛伸」」      / 母集団「炉端肉焼き処猛伸 たけし」
      v1 は「辞書の名前が題名に含まれるか」しか見ていないので当たらない。
      **店名の芯（欽山・猛伸）で照合すれば取れる。**

  **F2 母集団にその店が無い**（直せない）
      八軒苑・高松文八・キッチンベースLei・鶴 KAKU は**全国どこにも無かった**。
      抽出器をどう直しても、#843 の母集団に行が無ければ結び付けられない。

さらに v1 は地名の対応表が粗く、`福岡` → `福岡市`（2,015行）だけを見て
**`福岡市博多区`（3,826行）や `福岡市中央区`（5,915行）を見ていなかった**。

## v2 でやること

  1. 地名の表記 → **その表記で始まる locality 全部**に広げる
  2. 店名から**芯**を作る（カテゴリ語の接頭・接尾、支店名、記号、空白を落とす）
  3. 芯が題名に出てきたら候補にする。**芯がその地域で一意**であることは要求する
  4. 芯が地名そのものだったり、一般語だったりするものは辞書から落とす

## この実装が言えないこと

  - **経路存在率の側**の改善であり、権利処理（規約・許諾）は別問題
  - 一意性を地域内に緩めた分、**偽陽性は必ず増える**。目視で確かめること
  - 「特定できた店」が母集団のどれだけを覆うかは**別の測定**

実行:
    python3 measure_shorts_area_first_v2.py --eval-labels
    python3 measure_shorts_area_first_v2.py --pool out/shorts_identification_pool.json
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

# 芯を作るときに落とす語。前後どちらに付いていても落とす。
CAT = ("らぁめん", "らーめん", "ラーメン", "中華そば", "手打ちうどん", "うどん", "そば",
       "寿司", "鮨処", "鮨", "すし", "立喰い", "立ち食い", "焼肉", "炉端肉焼き処",
       "焼鳥", "焼き鳥", "とんかつ", "天ぷら", "餃子", "カレー", "curry", "定食",
       "居酒屋", "食堂", "喫茶", "カフェ", "cafe", "レストラン", "バー", "bar",
       "日本料理", "海鮮", "海鮮丼", "牛丼", "精肉卸し直営", "製麺所", "麺処", "麺屋")
SUFFIX = re.compile(r"(本店|支店|[^\s]{1,8}店)$")
SYM = re.compile(r"[\s　・\-—–_,，.。'\"“”‘’!！?？&＆/／|｜()（）\[\]【】『』「」]+")
GENERIC = {"やまちゃん", "大将", "一番", "本舗", "屋台", "ごはん", "めし", "キッチン",
           "ダイニング", "テラス", "ハウス", "パーラー", "ホール", "スタンド"}


def core_of(name: str) -> str:
    s = SYM.sub("", name)
    for _ in range(3):
        for c in CAT:
            if s.startswith(c) and len(s) > len(c) + 1:
                s = s[len(c):]
            if s.endswith(c) and len(s) > len(c) + 1:
                s = s[: -len(c)]
    m = SUFFIX.search(s)
    if m and len(s) - len(m.group(0)) >= 2:
        s = s[: m.start()]
    return s


class AreaIndexV2:
    def __init__(self) -> None:
        loc_rows: dict[str, list] = collections.defaultdict(list)
        self.localities: set[str] = set()
        self.regions: dict[str, list] = collections.defaultdict(list)
        csv.field_size_limit(10**7)
        n = 0
        for fn in SOURCES:
            p = FIXTURES / fn
            if not p.exists():
                continue
            with p.open(encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    nm = (r.get("name") or "").strip()
                    loc = (r.get("locality") or "").strip()
                    if not nm or not loc:
                        continue
                    n += 1
                    has = int(r.get("n_websites") or 0) + int(r.get("n_socials") or 0)
                    loc_rows[loc].append((nm, has > 0))
                    self.localities.add(loc)
        # 芯 -> (件数, 代表名, リンク有無) を locality ごとに持つ
        self.core: dict[str, dict[str, list]] = {}
        place_tokens = set()
        for loc in self.localities:
            place_tokens.add(loc)
            place_tokens.add(re.sub(r"(市|区|町|村)$", "", loc))
        for loc, rows in loc_rows.items():
            tbl: dict[str, list] = collections.defaultdict(list)
            for nm, has in rows:
                c = core_of(nm)
                if len(c) < 2 or c in GENERIC or c in place_tokens:
                    continue
                tbl[c].append((nm, has))
            self.core[loc] = tbl
        # 地名表記 -> その表記で始まる locality 全部
        self.place2locs: dict[str, list[str]] = collections.defaultdict(list)
        for loc in self.localities:
            self.place2locs[loc].append(loc)
            core = re.sub(r"(市|区|町|村)$", "", loc)
            if len(core) >= 2:
                self.place2locs[core].append(loc)
        for loc in self.localities:
            for pref in (loc[:2], loc[:3]):
                if len(pref) >= 2 and pref not in self.place2locs:
                    pass
        self.place_list = sorted(self.place2locs, key=len, reverse=True)
        print(f"[v2] {n:,} 行 / locality {len(self.localities):,} / "
              f"地名表記 {len(self.place_list):,}", file=sys.stderr)

    def find_places(self, text: str, limit: int = 3):
        out = []
        for surf in self.place_list:
            if len(surf) < 2:
                continue
            if surf in text:
                out.append(surf)
                if len(out) >= limit:
                    break
        return out

    def match(self, title: str):
        t = SYM.sub("", title)
        for surf in self.find_places(title):
            locs = self.place2locs[surf]
            best = None
            for loc in locs:
                for c, hits in self.core.get(loc, {}).items():
                    if c in t and len(hits) == 1:            # 地域内で一意
                        if best is None or len(c) > len(best[0]):
                            best = (c, hits[0][0], hits[0][1], loc)
            if best:
                return {"core": best[0], "store": best[1], "link": best[2],
                        "area": best[3], "place": surf}
        return None


def evaluate(idx) -> None:
    lab = json.loads((OUT_DIR / "shorts_title_human_ceiling_labels.json")
                     .read_text(encoding="utf-8"))
    ok, ng = lab["examples_ok"], lab["examples_ng"]
    hit, rows = 0, []
    print("\n=== 人間が『可』とした 30 本への recall ===", file=sys.stderr)
    for e in ok:
        m = idx.match(e["title"])
        got = m["store"] if m else None
        # #1345 【バグ】最初の判定は `core_of(got) in 題名` を許していた。
        #   これだと『大番』に対して『大通食堂』が○になる（芯「大通」が
        #   題名の「大通西15丁目」に出るため）。recall が 56.7% と出たが**嘘**である。
        #   人間が読んだ店名と機械の店名を、**互いの芯で突き合わせる**のが正しい。
        human = SYM.sub("", e["store"])
        hcore = core_of(human)
        good = bool(got and hcore and len(hcore) >= 2
                    and (hcore in SYM.sub("", got) or core_of(got) == hcore))
        hit += good
        rows.append({"title": e["title"], "human": e["store"], "machine": got,
                     "ok": good})
        print(f"  {'○' if good else '×'} 人間={e['store'][:20]:22} "
              f"機械={str(got)[:26]:28} 地名={m['place'] if m else '-'}", file=sys.stderr)
    fp = 0
    print("\n=== 人間が『不可』とした 10 本（当ててはいけない）===", file=sys.stderr)
    for e in ng:
        m = idx.match(e["title"])
        if m:
            fp += 1
            print(f"  × 誤爆 {m['store']}（地名 {m['place']}） ← {e['title'][:38]}",
                  file=sys.stderr)
    print(f"\n  **recall {hit}/{len(ok)} = {hit/len(ok)*100:.1f}%**"
          f"  / 『不可』への誤爆 **{fp}/{len(ng)}**", file=sys.stderr)
    p = OUT_DIR / "shorts_area_first_v2_eval.json"
    p.write_text(json.dumps({"recall": hit / len(ok), "hit": hit, "n_ok": len(ok),
                             "fp_on_ng": fp, "n_ng": len(ng), "rows": rows},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-labels", action="store_true")
    ap.add_argument("--pool")
    args = ap.parse_args()
    idx = AreaIndexV2()
    if args.eval_labels:
        evaluate(idx)
    if args.pool:
        pool = json.loads(Path(args.pool).read_text(encoding="utf-8"))
        rows = pool["rows"]
        hits = []
        for r in rows:
            m = idx.match(r["title"])
            if m:
                hits.append({**r, **m})
        n = len(rows)
        d = len({h["store"] for h in hits})
        nl = sum(1 for h in hits if h.get("link") is False)
        print(f"\n=== 収集した Shorts への適用（n={n}）===", file=sys.stderr)
        print(f"  特定できた **{len(hits)}/{n} = {len(hits)/n*100:.2f}%**", file=sys.stderr)
        print(f"  distinct 店 **{d}**", file=sys.stderr)
        print(f"  うちリンク無し層 {nl}/{max(len(hits),1)} = "
              f"{nl/max(len(hits),1)*100:.1f}%", file=sys.stderr)
        p = OUT_DIR / "shorts_area_first_v2_pool.json"
        p.write_text(json.dumps({"n": n, "n_hits": len(hits), "rate": len(hits) / n,
                                 "distinct_stores": d, "n_nolink": nl,
                                 "hits": hits[:800],
                                 "caveat": "**経路存在率**。目視で precision を"
                                           "確かめるまでこの率は使えない。"},
                                ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
