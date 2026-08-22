#!/usr/bin/env python3
"""#1345 #1310 裏取りの地名キーが政令指定都市で壊れている（実測と修正案の評価）

## 見つけ方（Shorts の妙な並びから）

カテゴリ×エリア検索の実測にこう出ていた。

    ラーメン 新宿 → 0店   ラーメン 大阪 → 0店   ラーメン 福岡 → 0店
    ラーメン 札幌 → 2店   ラーメン 仙台 → 2店   ラーメン 高松 → 4店

**大都市ほど特定できていない。** 最初は「大都市ほど同名が多く、辞書から
落ちているのだろう」と考えたが、**これは外れた**
（`measure_dict_blindspot.py`: 店数の第1分位 28.70% / 第5分位 29.53% = 0.97倍。
密度と辞書落ち率は無関係）。

実物を追うと、原因は裏取りの地名キーだった。

    locality_needle("大阪市中央区") -> "中央区"
    locality_needle("福岡市中央区") -> "中央区"
    locality_needle("静岡市葵区")   -> "葵区"

`locality_needle` は行政区画トークンの**最後**を返すので、政令指定都市では
**区名だけ**になる。ところが動画のタイトルや記事に書かれるのは「大阪」「福岡」で
あって「中央区」ではない。しかも「中央区」は**10市にまたがる**ので、
裏取りの手掛かりとしても弱い。

| | |
|---|---:|
| 政令市型『〜市〜区』の店 | **287,730 = 24.82%** |
| その needle 最多「中央区」 | 90,518店・**10市**にまたがる |
| 複数の市にまたがる区名 | 19 / 154 |

**母集団の約1/4で、裏取りキーが「稀にしか書かれず、しかも曖昧な語」になっている。**

## 測るもの

裏取りキーの3案を同じ本文に当てて、特定できる店の数と**目視 precision** を比べる。

  - A（現行）… `locality` 丸ごと、または `locality_needle`（＝区名）
  - B … A ＋ **市トークン**（「大阪市」「福岡市」）
  - C … B ＋ **市名から「市」を落とした形**（「大阪」「福岡」）

C は手掛かりが緩いので偽陽性が増えるはずである。**増分は必ず目視する。**

## この測定が言えないこと

ここで測るのは裏取り段の通過率だけである。辞書に載っていない屋号
（同名2箇所以上など）は、どの案でも拾えない。

**ネットワークアクセスはしない**（保存済みのタイトルを使う）。

実行:
    python3 measure_needle_fix.py
"""

from __future__ import annotations

import collections
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    NameMatcher, locality_needle, normalize_ja,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

CITY_WARD = re.compile(r"^(?:北海道|京都府|大阪府|東京都|.{2,3}県)?(.+?市)(.+?区)$")
_BARE_NG = {"市", "区", "町", "村"}
# 末尾の行政区画語を1つ落とすためのもの（D 案）。
_TAIL = re.compile(r"(市|区|町|村)$")
# 落とすと一般語・他地名になってしまうものは除く（増やしすぎると偽陽性になる）
_BARE_STOP = {"中央", "北", "南", "東", "西", "港", "緑", "旭", "青葉", "美里",
              "大和", "山手", "本", "新", "上", "下", "中", "白", "泉"}


def city_token(loc: str) -> str:
    m = CITY_WARD.match(loc or "")
    return m.group(1) if m else ""


def bare_form(tok: str) -> str:
    """「新宿区」->「新宿」、「高松市」->「高松」。落とせなければ空。"""
    if not tok:
        return ""
    b = _TAIL.sub("", tok, count=1)
    if len(b) < 2 or b in _BARE_STOP or b == tok:
        return ""
    return b


def build_variants(m: NameMatcher):
    """屋号 -> {A/B/C それぞれで許す裏取り語の集合} を作る。

    NameMatcher.area は屋号 -> (locality, region) を持っている。
    needle は同じ関数で計算し直す（実装を二重に持たない）。
    """
    var: dict[str, dict[str, set]] = {}
    for name, pair in m.area.items():
        loc, reg = pair if isinstance(pair, (tuple, list)) else (pair, "")
        nd = locality_needle(loc or "")
        a = {x for x in (loc, nd) if x}
        ct = city_token(loc or "")
        b = a | ({ct} if ct else set())
        bare = bare_form(ct)
        c = b | ({bare} if bare else set())
        # D: 政令市に限らず、locality と needle の**末尾の行政区画語を落とした形**も許す。
        #    「新宿区」->「新宿」（特別区は CITY_WARD に当たらないので C では救えない）
        d = set(c)
        for tok in (loc or "", nd):
            bf = bare_form(tok)
            if bf:
                d.add(bf)
        var[name] = {"A": a, "B": b, "C": c, "D": d}
    return var


def match_variant(m: NameMatcher, text: str, var, key: str) -> set[str]:
    """【自戒】最初の版は `m.area` のキーから自前で automaton を作った。

    `m.area` には**辞書に採用しなかった屋号まで入っている**（890,838 対 745,309）ため、
    『グル』『司』『大』のような1〜2文字の語を拾い、ラテン名の語境界規則も外れた。
    測定は無効だった。**照合そのものは `m.match()` に任せ、
    変えるのは裏取りの語だけ**にする。
    """
    tj = normalize_ja(text)
    out = set()
    for nm in m.match(text):
        loc, region = m.area.get(nm, ("", ""))
        words = var.get(nm, {}).get(key, set()) | ({region} if region else set())
        for w in words:
            if w and w in tj:
                out.add(nm)
                break
    return out


def main() -> None:
    m = NameMatcher()
    var = build_variants(m)
    n_b = sum(1 for v in var.values() if v["B"] - v["A"])
    n_c = sum(1 for v in var.values() if v["C"] - v["B"])
    n_d = sum(1 for v in var.values() if v["D"] - v["C"])
    print(f"辞書の屋号 {len(var):,}", file=sys.stderr)
    print(f"  B で裏取り語が増える屋号 {n_b:,} = {n_b/max(len(var),1)*100:.2f}%",
          file=sys.stderr)
    print(f"  C でさらに増える屋号     {n_c:,} = {n_c/max(len(var),1)*100:.2f}%",
          file=sys.stderr)
    print(f"  D でさらに増える屋号     {n_d:,} = {n_d/max(len(var),1)*100:.2f}%",
          file=sys.stderr)

    # 自己テスト: 現行 A が `match_corroborated` と一致することを確かめる。
    # ここがずれていたら、以降の比較は意味を持たない。
    probe = ["【福岡グルメ】九州はかた 大吉寿司（福岡市博多区那珂6丁目）",
             "桂花ラーメン 新宿東口駅前店 熊本とんこつラーメン",
             "札幌ラーメンさんぱち780円で食べられます"]
    ng = 0
    for t in probe:
        a = match_variant(m, t, var, "A")
        b = m.match_corroborated(t)
        if a != b:
            ng += 1
            print(f"  **不一致** A={sorted(a)} vs 現行={sorted(b)}  ← {t[:40]}",
                  file=sys.stderr)
    if ng:
        print("  **A が現行と一致しない。比較の土台が壊れているので測定しない。**",
              file=sys.stderr)
        raise SystemExit(1)
    print("自己テスト: A == match_corroborated  ok", file=sys.stderr)

    # --- 保存済みのタイトルで測る -------------------------------------------
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true",
                    help="未目視の第2標本（別カテゴリ×別エリア）で検証する")
    a2 = ap.parse_args()
    src = OUT_DIR / ("shorts_route_search_fresh.json" if a2.fresh
                     else "shorts_route_search.json")
    rows = json.loads(src.read_text(encoding="utf-8"))["rows"]
    texts = [(r["query"], r["title"], r["is_short"]) for r in rows if r.get("title")]
    print(f"\n=== 保存済みタイトル {len(texts):,} 本（カテゴリ×エリア検索）===",
          file=sys.stderr)

    got: dict[str, set] = {"A": set(), "B": set(), "C": set(), "D": set()}
    hit: collections.Counter = collections.Counter()
    ex_b, ex_c, ex_d = [], [], []
    by_query: dict[str, dict[str, set]] = collections.defaultdict(
        lambda: {"A": set(), "B": set(), "C": set(), "D": set()})
    for q, t, _sh in texts:
        a = match_variant(m, t, var, "A")
        b = match_variant(m, t, var, "B")
        c = match_variant(m, t, var, "C")
        dd = match_variant(m, t, var, "D")
        for k, s in (("A", a), ("B", b), ("C", c), ("D", dd)):
            got[k] |= s
            by_query[q][k] |= s
            if s:
                hit[k] += 1
        if b - a and len(ex_b) < 15:
            ex_b.append({"query": q, "title": t[:64], "names": sorted(b - a)})
        if c - b and len(ex_c) < 20:
            ex_c.append({"query": q, "title": t[:64], "names": sorted(c - b)})
        if dd - c and len(ex_d) < 20:
            ex_d.append({"query": q, "title": t[:64], "names": sorted(dd - c)})

    n = len(texts)
    print(f"{'案':4}{'当たった本数':>12}{'率':>9}{'distinct 店':>12}", file=sys.stderr)
    for k, label in (("A", "A 現行"), ("B", "B +市"), ("C", "C +市名"),
                     ("D", "D +区名も")):
        print(f"{label:8}{hit[k]:>10,}{hit[k]/n*100:>8.2f}%{len(got[k]):>12,}",
              file=sys.stderr)

    print(f"\n=== エリア別（クエリのエリア語ごとの distinct 店）===", file=sys.stderr)
    per_area: dict[str, dict[str, set]] = collections.defaultdict(
        lambda: {"A": set(), "B": set(), "C": set(), "D": set()})
    for q, d in by_query.items():
        area = q.split()[-1]
        for k in ("A", "B", "C", "D"):
            per_area[area][k] |= d[k]
    for area, d in sorted(per_area.items(), key=lambda kv: -len(kv[1]["D"])):
        print(f"  {area:6} A={len(d['A']):>3}  B={len(d['B']):>3}  "
              f"C={len(d['C']):>3}  **D={len(d['D']):>3}**", file=sys.stderr)

    print(f"\n=== B の増分（目視で precision を確かめる）===", file=sys.stderr)
    for e in ex_b:
        print(f"  {e['names']}  ← [{e['query']}] {e['title']}", file=sys.stderr)
    print(f"\n=== C の増分（目視で precision を確かめる）===", file=sys.stderr)
    for e in ex_c:
        print(f"  {e['names']}  ← [{e['query']}] {e['title']}", file=sys.stderr)
    print(f"\n=== D の増分（目視で precision を確かめる）===", file=sys.stderr)
    for e in ex_d:
        print(f"  {e['names']}  ← [{e['query']}] {e['title']}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / ("needle_fix_fresh.json" if a2.fresh else "needle_fix.json")
    p.write_text(json.dumps(
        {"n_names": len(var), "n_gain_B": n_b, "n_gain_C": n_c,
         "n_texts": n, "hits": dict(hit),
         "distinct": {k: len(v) for k, v in got.items()},
         "by_area": {a: {k: sorted(v) for k, v in d.items()}
                     for a, d in per_area.items()},
         "examples_B": ex_b, "examples_C": ex_c, "examples_D": ex_d,
         "caveat": "裏取り段の通過率のみ。辞書に載っていない屋号はどの案でも拾えない。"
                   "増分の precision は目視で確かめること。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
