#!/usr/bin/env python3
"""#1344 ブロガーの供給量を確定させる（前回「測れていない」で止めた宿題）

## なぜ

必要人数は 15,000〜17,000人と出したが、**そもそも何人発見できるのか**が
測れていなかった。前回はランキングのページ送りが効かず断念した。

## 分かったこと（今回の前提確認）

`?p=` を 1/2/3/5/10 と変えても**返る 86件がまったく同じ**だった
（ページ間の積集合が 86 で、和集合も 86）。
**blogmura のランキングはページ送りを無視している。**
1カテゴリから見えるのは上位 86件だけである。

## ならばカテゴリを全部舐める

`gourmet.blogmura.com` の配下カテゴリを全部集め、それぞれのランキングから
プロフィールIDを取り、**和集合**を数える。これが
「このディレクトリから発見できるブロガーの上限」である。

## この測定が言えないこと

  - blogmura に登録しているブロガーだけ。**登録していない人は数えられない**
  - ランキング上位 86件しか見えないので、**下位は数えられない**（＝下限）

**送信・登録は一切しない。公開ページを読むだけ。**

実行:
    python3 measure_blogmura_supply.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
_PROF = re.compile(r"blogmura\.com/profiles/(\d+)")
_CAT = re.compile(r"https://gourmet\.blogmura\.com/([a-z0-9_]+)/")


def get(u: str, timeout: int = 20) -> str:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:                                        # noqa: BLE001
        return ""


def main() -> None:
    top = get("https://gourmet.blogmura.com/")
    cats = sorted(set(_CAT.findall(top)))
    print(f"グルメ配下のカテゴリ {len(cats)}", file=sys.stderr)

    union: set[str] = set()
    per_cat: dict[str, int] = {}
    for i, c in enumerate(cats, 1):
        ids: set[str] = set()
        for path in (f"https://gourmet.blogmura.com/{c}/ranking/in/",
                     f"https://gourmet.blogmura.com/{c}/"):
            ids |= set(_PROF.findall(get(path)))
            time.sleep(0.4)
        per_cat[c] = len(ids)
        union |= ids
        if i % 20 == 0:
            print(f"  {i}/{len(cats)} … 和集合 {len(union):,}", file=sys.stderr)

    print(f"\n=== blogmura グルメ配下から発見できるブロガー ===", file=sys.stderr)
    print(f"  カテゴリ {len(cats)}", file=sys.stderr)
    print(f"  **和集合（distinct プロフィール） {len(union):,} 人**", file=sys.stderr)
    print(f"  カテゴリあたり平均 {sum(per_cat.values())/max(len(cats),1):.1f} 件",
          file=sys.stderr)
    print(f"  （単純合計 {sum(per_cat.values()):,} なので、"
          f"重複率 {1-len(union)/max(sum(per_cat.values()),1):.1%}）", file=sys.stderr)
    top20 = sorted(per_cat.items(), key=lambda kv: -kv[1])[:15]
    for c, n in top20:
        print(f"    {c:22} {n:>4}", file=sys.stderr)

    need_lo, need_hi = 15_000, 17_000
    print(f"\n  必要人数 {need_lo:,}〜{need_hi:,} に対して "
          f"**{len(union)/need_lo*100:.1f}〜{len(union)/need_hi*100:.1f}%**",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blogmura_supply.json"
    p.write_text(json.dumps(
        {"n_categories": len(cats), "n_bloggers_union": len(union),
         "per_category": per_cat,
         "caveat": "blogmura に登録しているブロガーだけ。"
                   "ランキングは上位86件しか返さない（ページ送りは無視される）ので下限。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
