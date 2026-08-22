#!/usr/bin/env python3
"""#1344 特化ブロガーのリンク無し層が薄いのは、**都市圏に偏っているせい**ではないのか

## なぜ

特化ブロガーの結論はこの一点で決まっている:

    リンク無し層の割合  特化 12.80% / 非特化 41.33% / 母集団の基準 30.31%
    → 経路存在率 5.31pt に対し、他経路と重ならない純増は **0.68pt**

しかし 250 店のうち 186 店を稼いだのは上位2ブログ
（`favoriteslibrary-ramen.com` 121店・リンク無し 8.26%、
`titabetamono.livedoor.blog` 65店・同 20.00%）で、**どちらも首都圏のラーメンブログ**である。
首都圏の店は Overture の収録率が高いので、**リンク無しが薄いのは当たり前**かもしれない。

一方、地方のブログは高く出ていた:

    ogamuku.com（栃木・群馬）        20.00%
    sapporo-eatfull-life（札幌）      50.00%（n=2 なので参考値）

**「特化ブロガーはリンク無し層に効かない」のか、
「首都圏のブロガーはリンク無し層に効かない」のかで、次の一手が変わる。**
後者なら、**探すべきは地方の特化ブロガー**である。

## 測るもの

再クロールはしない。**保存済みの記事本文（`out/_blog_text/`）だけ**を使う。

  1. 一致した店を `NameMatcher.area`（locality, region）で**都道府県**に割り当てる
  2. **三大都市圏 / それ以外**に分けて、それぞれのリンク無し率を出す
  3. ブログごとに「店の何%が三大都市圏か」を出し、
     **都市圏比率とリンク無し率の関係**を見る

## この測定が言えないこと

  - `NameMatcher.area` は**名前が一意な店にしか付かない**（同名が複数箇所にある店は落ちる）。
    したがって地域が付く店は全体の部分集合である
  - ブログ 14 件の標本である。**都道府県ごとの一般化はできない**
  - リンク無しの判定は fixture の `n_socials` / `n_websites` に依存する（従来と同じ）

実行:
    python3 measure_blog_nolink_by_region.py
"""

from __future__ import annotations

import collections
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_blog_yield_by_focus import load_link_map  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# 三大都市圏（総務省の定義に近い括り。ここで決めた）
METRO = {"東京都", "神奈川県", "千葉県", "埼玉県",
         "大阪府", "京都府", "兵庫県", "奈良県",
         "愛知県", "岐阜県", "三重県"}

SOURCES = (("特化", "blog_yield_by_focus_focused_dishcat.json", "focused"),
           ("非特化", "blog_yield_by_focus_general.json", "general"))


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def main() -> None:
    m = NameMatcher()
    link_of = load_link_map()

    rows = []
    for label, fn, key in SOURCES:
        fp = OUT_DIR / fn
        if not fp.exists():
            print(f"**{fn} が無い。数字を出さない。**", file=sys.stderr)
            raise SystemExit(2)
        d = json.loads(fp.read_text(encoding="utf-8"))
        for r in d["rows"]:
            if r.get("group") not in ("特化", "非特化"):
                continue
            rows.append((label, r))

    print(f"対象ブログ {len(rows)} 件（再クロールなし・保存済みの一致結果を使う）",
          file=sys.stderr)

    agg: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
    per_blog = []
    for label, r in rows:
        n_metro = n_other = nl_metro = nl_other = n_noregion = 0
        for s in r.get("stores") or []:
            if s not in link_of:
                continue
            nolink = not link_of[s]
            area = m.area.get(s)
            if not area:
                n_noregion += 1
                continue
            region = area[1] or ""
            tier = "三大都市圏" if region in METRO else "それ以外"
            agg[(label, tier)]["n"] += 1
            agg[(label, tier)]["nolink"] += nolink
            if tier == "三大都市圏":
                n_metro += 1
                nl_metro += nolink
            else:
                n_other += 1
                nl_other += nolink
        tot = n_metro + n_other
        per_blog.append({
            "group": label, "domain": r["domain"],
            "n_with_region": tot, "n_no_region": n_noregion,
            "metro_share": n_metro / tot if tot else None,
            "nolink_rate": (nl_metro + nl_other) / tot if tot else None,
            "n_metro": n_metro, "nl_metro": nl_metro,
            "n_other": n_other, "nl_other": nl_other,
        })

    print(f"\n=== 地域別のリンク無し率 ===", file=sys.stderr)
    for label in ("特化", "非特化"):
        for tier in ("三大都市圏", "それ以外"):
            c = agg[(label, tier)]
            n, k = c["n"], c["nolink"]
            if not n:
                print(f"  {label:6} {tier:8} n=0（数字を出さない）", file=sys.stderr)
                continue
            lo, hi = wilson(k, n)
            print(f"  {label:6} {tier:8} {k:>4}/{n:<4} = **{k/n*100:6.2f}%**"
                  f"  95%CI [{lo*100:5.1f}, {hi*100:5.1f}]", file=sys.stderr)

    print(f"\n=== ブログごと（都市圏比率 → リンク無し率）===", file=sys.stderr)
    for b in sorted(per_blog, key=lambda x: -(x["n_with_region"] or 0)):
        if not b["n_with_region"]:
            continue
        print(f"  [{b['group']}] {b['domain'][:30]:32} 店 {b['n_with_region']:>3}"
              f"  都市圏 {b['metro_share']*100:5.1f}%"
              f"  リンク無し **{b['nolink_rate']*100:5.2f}%**", file=sys.stderr)

    # 都市圏比率とリンク無し率の相関（Pearson。標本が小さいので参考値）
    xs = [b["metro_share"] for b in per_blog if b["n_with_region"] >= 5]
    ys = [b["nolink_rate"] for b in per_blog if b["n_with_region"] >= 5]
    r = None
    if len(xs) >= 3:
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        den = math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
        r = num / den if den else None
        print(f"\n  都市圏比率 × リンク無し率 の相関 r = "
              f"**{r:+.3f}**（店5件以上のブログ {len(xs)} 件。**参考値**）",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blog_nolink_by_region.json"
    p.write_text(json.dumps({
        "metro_definition": sorted(METRO),
        "by_group_tier": {f"{a}/{b}": dict(c) for (a, b), c in agg.items()},
        "per_blog": per_blog, "correlation_metro_vs_nolink": r,
        "caveat": "NameMatcher.area は名前が一意な店にしか付かないので、地域が付く店は"
                  "部分集合である。ブログ14件の標本で、都道府県ごとの一般化はできない。"
                  "リンク無しの判定は fixture の n_socials / n_websites に依存する。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
