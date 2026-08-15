#!/usr/bin/env python3
"""#1273 YouTube 経路は自社サイト経路に**足し算になるのか**

## なぜ

実効天井 19.26–25.63% は**自社サイトの料理写真**から出した数字で、
この経路は**店がリンク（website / socials）を持っていること**を必要とする。
リンク有りは 789,235 = 69.69%、リンク無しは 343,247 = 30.31% である。

YouTube 経路（①）は distinct 12,013 店に届いている。だが

  - その 12,013 店が**ほとんどリンク有り**なら、自社サイト経路と同じ店を見ているだけで
    **足し算にならない**
  - **リンク無しが多い**なら、他のどの経路も届かない層に効いていることになり、
    少ないながら**純増**である

これを一度も測っていなかった。**経路の重なりは、経路の大きさと同じくらい重要である。**

## 測り方

母集団 3ソースから「正規化した屋号 → リンクの有無」を作り、
①が当てた 12,013 店に突き合わせる。母集団の基準率（30.31%）と比べる。

同名が複数ある屋号は辞書から落ちているので、屋号→店は1対1で引ける。

## この数字が言えないこと

リンクの有無は**自社サイト経路が使えるか**の代理であって、
その店に実際に料理写真があるかではない。ここで測るのは**重なりの構造**だけである。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_youtube_additivity.py
"""

from __future__ import annotations

import collections
import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import (  # noqa: E402
    NameMatcher, has_cjk, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
STATE = OUT_DIR / "crawl_scaleup_state.json"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

POP_LINK = 789_235
POP_NOLINK = 343_247
POP_TOTAL = POP_LINK + POP_NOLINK


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def main() -> None:
    csv.field_size_limit(10**7)
    link_of: dict[str, bool] = {}
    src_of: dict[str, str] = {}
    for fn in SOURCES:
        p = FIXTURES / fn
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                key = normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()
                if not key:
                    continue
                has = (int(r.get("n_socials") or 0) > 0
                       or int(r.get("n_websites") or 0) > 0)
                link_of[key] = link_of.get(key, False) or has
                src_of.setdefault(key, fn.split("_")[0])
    print(f"屋号→リンク有無 {len(link_of):,} 件", file=sys.stderr)

    m = NameMatcher()
    st = json.loads(STATE.read_text(encoding="utf-8"))
    hit: set[str] = set()
    for c in st["channels"].values():
        for v in c.get("videos") or []:
            t = (v.get("title") or "").strip()
            if t:
                hit |= m.match_corroborated(t)
    print(f"①が当てた distinct 店舗 {len(hit):,}", file=sys.stderr)

    known = [k for k in hit if k in link_of]
    n_link = sum(1 for k in known if link_of[k])
    n_nolink = len(known) - n_link
    lo, hi = wilson(n_nolink, len(known))

    print(f"\n=== ①が当てた店のリンク保有（突合できた {len(known):,} 店）===",
          file=sys.stderr)
    print(f"  リンク有り {n_link:>6,} = {n_link/len(known)*100:>5.2f}%", file=sys.stderr)
    print(f"  リンク無し {n_nolink:>6,} = {n_nolink/len(known)*100:>5.2f}%"
          f"  95%CI {lo*100:.2f}-{hi*100:.2f}%", file=sys.stderr)
    print(f"\n  母集団の基準率: リンク無し {POP_NOLINK/POP_TOTAL*100:.2f}%",
          file=sys.stderr)
    ratio = (n_nolink / len(known)) / (POP_NOLINK / POP_TOTAL)
    print(f"  **基準率に対する比 {ratio:.2f}倍**", file=sys.stderr)

    by_src = collections.Counter(src_of.get(k, "?") for k in known)
    print(f"\n=== ソース別 ===", file=sys.stderr)
    for s, c in by_src.most_common():
        print(f"  {s:10} {c:>6,} = {c/len(known)*100:>5.2f}%", file=sys.stderr)

    add_pt = n_nolink / POP_TOTAL * 100
    print(f"\n=== 足し算になる分 ===", file=sys.stderr)
    print(f"  ①だけが届くリンク無し店 {n_nolink:,} = 母集団の **{add_pt:.3f}pt**",
          file=sys.stderr)
    print(f"  （リンク有りの {n_link:,} 店は自社サイト経路と重なりうる）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "youtube_additivity.json"
    p.write_text(json.dumps(
        {"n_hit": len(hit), "n_matched": len(known),
         "n_link": n_link, "n_nolink": n_nolink,
         "nolink_rate": n_nolink / len(known), "nolink_wilson95": [lo, hi],
         "population_nolink_rate": POP_NOLINK / POP_TOTAL,
         "ratio_vs_population": ratio,
         "additive_pt": add_pt,
         "by_source": dict(by_src),
         "caveat": "リンクの有無は自社サイト経路が使えるかの代理であって、"
                   "その店に料理写真があるかではない。ここで測るのは重なりの構造だけ。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
