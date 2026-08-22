#!/usr/bin/env python3
"""#1344 「ブロガーは何人いるのか」を数え直す（ブログサービス上の個人を1人として数える）

## 【訂正】これまでの「1,228ブログ」は過小である

`measure_food_blogs.py --stage discover` は**ドメイン単位**で数えていた。
そのため

    ameblo.jp        … 2,216記事、14カテゴリ
    plaza.rakuten.co.jp / blog.livedoor.jp / exblog.jp …

が**それぞれ1ブログ**として数えられ、しかも PLATFORM 除外で丸ごと落としていた。
実際にはこれらは**サービスであって、個人はその下のパス**にいる。

    https://ameblo.jp/0070011/entry-12921995415.html
                      ^^^^^^^ ここが1人のブロガー

独自ドメインのブロガーだけを数えると供給量を大きく取りこぼす。
オーナーの問い「本当に千ブロガーぐらい必要かもしれんな」に答えるには、
**まず供給が何人いるのか**を正しく数える必要がある。

## 数え方（決め方を明記する）

ブロガー1人の識別子を次のように定める。

  - 既知のブログサービス（下の PLATFORM_PATH / PLATFORM_SUB）に載っている場合
      * パス型 : `ameblo.jp/<user>`     … 第1パスセグメントを個人とみなす
      * サブドメイン型 : `<user>.exblog.jp` … 第1ラベルを個人とみなす
  - それ以外は**登録可能ドメイン**（例 `umai-net.com`）を個人とみなす

この決め方は**過大にも過小にもなりうる**:
  - 過大側 … 同一人物が複数サービスに同じ記事を載せていると2人と数える
  - 過小側 … 1ドメインに複数の書き手がいる場合1人と数える
数字はこの定義のもとでの値である。

## 出すもの

  1. ブロガー数（従来のドメイン数と並べる）
  2. カテゴリを1つに絞っているブロガー数（ラーメン専門・焼肉専門…）
  3. カテゴリ別の内訳
  4. **KPI から逆算して、何人必要か**（1ブロガーあたりの実測 5.3店 を使う）

**ネットワークアクセスはしない。**

実行:
    python3 measure_blogger_supply.py
"""

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# 第1パスセグメントが個人を表すサービス
PLATFORM_PATH = {
    "ameblo.jp", "note.com", "plaza.rakuten.co.jp", "blog.livedoor.jp",
    "blog.goo.ne.jp", "minkara.carview.co.jp", "blogs.yahoo.co.jp",
    "www.instagram.com", "twitter.com", "x.com",
}
# 第1ラベル（サブドメイン）が個人を表すサービス
PLATFORM_SUB = (
    "exblog.jp", "seesaa.net", "hatenablog.com", "hatenadiary.jp",
    "blog.fc2.com", "fc2.com", "blogspot.com", "blogspot.jp",
    "officialblog.jp", "hateblo.jp", "jugem.jp", "cocolog-nifty.com",
    "at-links.jp", "wordpress.com", "muragon.com", "ti-da.net",
)

# 1ブロガーあたり distinct 店舗（`measure_food_blogs.py --stage deep` の実測）
STORES_PER_BLOGGER_DEEP = 5.3
STORES_PER_BLOGGER_25 = 2.42
# 恒等式で使っている seed 数と、必要増分（#1273）
SEED = 1_132_482
GAP_STORES = 502_482          # 70% までの不足（下限側）


def blogger_id(url: str) -> str | None:
    """URL からブロガー1人の識別子を作る。作れなければ None。"""
    try:
        u = urlparse(url)
    except ValueError:
        return None
    host = (u.netloc or "").lower().split(":")[0]
    if not host:
        return None
    segs = [s for s in (u.path or "").split("/") if s]
    if host in PLATFORM_PATH:
        if not segs:
            return None                      # サービスのトップだけ。個人が特定できない
        return f"{host}/{segs[0]}"
    for suf in PLATFORM_SUB:
        if host == suf:
            # 例 blog.fc2.com/xxx のようなパス型もある
            return f"{host}/{segs[0]}" if segs else None
        if host.endswith("." + suf):
            label = host[: -(len(suf) + 1)]
            first = label.split(".")[0]
            if first in ("www", "blog"):
                # blog.example.exblog.jp のような形は残りで判断
                parts = [p for p in label.split(".") if p not in ("www",)]
                first = parts[0] if parts else label
            return f"{first}.{suf}"
    # 独自ドメイン: www を落とすだけ（登録可能ドメインの厳密判定はしない）
    return host[4:] if host.startswith("www.") else host


def main() -> None:
    d = json.loads((OUT_DIR / "food_blogs_discover.json").read_text(encoding="utf-8"))
    doms: dict = d["domains"]

    bloggers: dict[str, dict] = {}
    for host, v in doms.items():
        for a in v.get("articles", []):
            bid = blogger_id(a)
            if not bid:
                continue
            e = bloggers.setdefault(bid, {"cats": set(), "n": 0, "host": host,
                                          "sample": a})
            e["cats"] |= set(v.get("categories", []))
            e["n"] += 1

    print(f"従来の数え方（ドメイン単位）   {len(doms):,}", file=sys.stderr)
    print(f"**ブロガー単位で数え直すと   {len(bloggers):,} 人**", file=sys.stderr)

    # サービス別
    svc: collections.Counter = collections.Counter()
    for bid in bloggers:
        if "/" in bid:
            svc[bid.split("/")[0]] += 1
        elif "." in bid:
            parts = bid.split(".")
            svc[".".join(parts[1:]) if len(parts) > 2 else "独自ドメイン"] += 1
        else:
            svc["独自ドメイン"] += 1
    print(f"\n=== どこに居るか（上位15）===", file=sys.stderr)
    for k, v in svc.most_common(15):
        print(f"  {k:26} {v:>6,} 人", file=sys.stderr)

    # カテゴリ集中度
    focused = {b: e for b, e in bloggers.items() if len(e["cats"]) == 1}
    print(f"\n=== カテゴリ集中度 ===", file=sys.stderr)
    print(f"  カテゴリ1つだけのブロガー {len(focused):,} 人 "
          f"= {len(focused)/max(len(bloggers),1)*100:.1f}%", file=sys.stderr)
    cat_cnt: collections.Counter = collections.Counter()
    for e in focused.values():
        cat_cnt[next(iter(e["cats"]))] += 1
    for k, v in cat_cnt.most_common(20):
        print(f"    {k:20} {v:>6,} 人", file=sys.stderr)

    # 記事数の分布（供給の厚み）
    ns = sorted((e["n"] for e in bloggers.values()), reverse=True)
    def pct(p):
        return ns[min(len(ns) - 1, int(len(ns) * p))] if ns else 0
    print(f"\n=== 1ブロガーの記事数（discover で見えた範囲。実際はもっと多い）===",
          file=sys.stderr)
    print(f"  中央値 {pct(0.5)} / 上位10% {pct(0.1)} / 最大 {ns[0] if ns else 0}",
          file=sys.stderr)

    # --- KPI からの逆算 -----------------------------------------------------
    print(f"\n=== 必要人数の逆算（**経路存在率ベース。実効ではない**）===",
          file=sys.stderr)
    print(f"  70% までの不足 {GAP_STORES:,}店（seed {SEED:,}）", file=sys.stderr)
    for label, spb in (("全アーカイブ走査 実測", STORES_PER_BLOGGER_DEEP),
                       ("25記事だけ 実測", STORES_PER_BLOGGER_25)):
        need = GAP_STORES / spb
        print(f"  {label:20} {spb:>5.2f}店/人 → **{need:>12,.0f} 人必要**",
              file=sys.stderr)
        print(f"      （いま見えているブロガー {len(bloggers):,} 人の "
              f"{need/max(len(bloggers),1):,.0f} 倍）", file=sys.stderr)
    print(f"\n  ※ 重複を無視した楽観値である。ブロガー同士は同じ有名店を書くので、"
          f"\n     実際の distinct はこれより**少ない**。上限の見積りではなく下限側の"
          f"\n     人数（=これだけ居ても足りない）として読むこと。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blogger_supply.json"
    p.write_text(json.dumps(
        {"n_domains_old": len(doms), "n_bloggers": len(bloggers),
         "by_service": dict(svc.most_common()),
         "n_focused": len(focused), "focused_by_category": dict(cat_cnt.most_common()),
         "articles_median": pct(0.5), "articles_p90": pct(0.1),
         "need_bloggers_deep": GAP_STORES / STORES_PER_BLOGGER_DEEP,
         "need_bloggers_25": GAP_STORES / STORES_PER_BLOGGER_25,
         "top_focused": sorted(
             ({"blogger": b, "cat": next(iter(e["cats"])), "n": e["n"],
               "sample": e["sample"]} for b, e in focused.items()),
             key=lambda x: -x["n"])[:120],
         "caveat": "ブロガーの識別はパス/サブドメインの規則で決めた（定義は docstring）。"
                   "記事数は discover が見た範囲の下限。必要人数は重複無視の楽観値。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
