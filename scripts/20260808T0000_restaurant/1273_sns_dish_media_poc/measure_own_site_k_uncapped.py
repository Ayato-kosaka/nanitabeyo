#!/usr/bin/env python3
"""#1273 KPI② の律速 k を、自社サイト経路について**打ち切り無し**で測り直す

## なぜ（測定のバグを見つけた）

KPI② は「1エリア×1カテゴリに distinct 5店」で、その律速は
**coverage ではなく k（1店あたり何品の料理写真が付くか）**だと結論してある。
都市1km セルで必要な k は **3.39** で、動画経路の実測 k は **1.27** しか出ない。

ところが自社サイト経路の k を保存済みデータから数え直すと、こうなっていた:

    料理画像 1枚: 23店 / 2枚: 14 / 3枚: 14 / 4枚: 17 / **5枚: 24** / 6枚以上: **0**
    92店のうち **84店が「検証した候補 5枚」ちょうど**

**これは分布ではない。上限 5 で打ち切られた跡である。**

## この打ち切り自体は既に見つけてある。新しいのは「範囲」

`MAX_VERIFY_PER_SITE` が 5 で天井になっていることは 8/14 の 66dd975
「1サイトの取得上限が効いていた。カテゴリ 3.5倍」で既に発見し、**30 に直してある**。
**発見の手柄はそこにあり、この節ではない。**

ただしそのときの検証は**チェーン 8 件だけ**で、コミットメッセージにも
「独立店には十分だが、メニュー写真が数十枚あるチェーン本部サイトではここが天井」
と書いてある。**つまり独立店は打ち切られていない前提だった。**

保存済みデータを数え直すと、**92 店のうち 84 店（91.3%）が上限に張り付いていた。**
チェーンだけの問題ではない。そして `own-website-images.json` は**古い上限 5 のまま**なので、
以降の節が引用してきた **k = 3.05 は真の値ではなく下限**である。

この節でやるのは、既知の修正を**全 92 店に当て直して真の k を出す**ことである。

## 測るもの

料理画像が1枚以上あった 92 店を、**同じ判定器・上限 30** で取り直し、

  1. 打ち切りの無い k の分布
  2. **k ≥ 3.39（都市1km で KPI② に要る値）を満たす店の割合**
  3. 打ち切りのせいで下振れしていた幅

## この測定が言えないこと

  - 上限 30 も上限である。30 に張り付く店が出たら**また打ち切り**である（数えて報告する）
  - 「料理画像が5枚ある」＝「5つの**別の**料理カテゴリが付く」ではない。
    KPI② が要求するのは distinct な料理なので、**カテゴリの重複は別途見る**
  - 元の測定から日が経っており、サイト側が変わっている可能性がある

実行:
    python3 measure_own_site_k_uncapped.py
"""

from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SRC = OUT_DIR / "own-website-images.json"

_spec = importlib.util.spec_from_file_location("ownsite", HERE / "own-website-images.py")
ownsite = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ownsite)          # noqa: E402

sys.path.insert(0, str(HERE))
from dish_category_matcher import CategoryMatcher  # noqa: E402

K_NEEDED_URBAN_1KM = 3.39                  # measure_k_ceiling.py


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    print(f"  上限 MAX_VERIFY_PER_SITE = {ownsite.MAX_VERIFY_PER_SITE}",
          file=sys.stderr)
    if ownsite.MAX_VERIFY_PER_SITE <= 5:
        print("**上限が 5 のままでは測り直す意味が無い。中止する。**", file=sys.stderr)
        raise SystemExit(2)

    d = json.loads(SRC.read_text(encoding="utf-8"))
    covered = [r for r in d["results"] if r.get("n_verified_dish", 0) >= 1]
    if args.limit:
        covered = covered[: args.limit]

    old_ks = [r["n_verified_dish"] for r in covered]
    n_at_cap = sum(1 for r in covered if len(r.get("verified") or []) >= 5)
    print(f"元データ: 料理画像あり {len(covered)} 店 / k 平均 "
          f"{statistics.mean(old_ks):.2f} / 最大 {max(old_ks)}", file=sys.stderr)
    print(f"  **検証枚数が 5 に張り付いていた店 {n_at_cap} = "
          f"{n_at_cap/len(covered)*100:.1f}%**（＝打ち切り）", file=sys.stderr)

    cm = CategoryMatcher()
    rows = []
    for i, r in enumerate(covered, 1):
        rec = {"id": r["id"], "name": r["name"], "locality": r["locality"],
               "tier": r["tier"], "website": r["website"], "domain": r["domain"],
               "is_portal": r["is_portal"]}
        out = ownsite.process(rec)
        # 料理カテゴリの distinct 数（KPI② が要求するのはこちら）
        cats: set = set()
        for v in out.get("verified") or []:
            txt = " ".join(str(v.get(k) or "") for k in ("alt", "context", "url"))
            cats |= {x["dish_category_id"] for x in cm.match(txt)}
        rows.append({"name": r["name"], "old_k": r["n_verified_dish"],
                     "new_k": out.get("n_verified_dish", 0),
                     "n_verified": len(out.get("verified") or []),
                     "n_candidates": len(out.get("candidates") or []),
                     "distinct_categories": len(cats),
                     "fail_reason": out.get("fail_reason")})
        if i % 10 == 0:
            print(f"  {i}/{len(covered)}", file=sys.stderr)

    ok = [r for r in rows if r["new_k"] >= 1]
    if not ok:
        print("**取り直しで1店も料理画像が取れなかった。数字を出さない。**",
              file=sys.stderr)
        raise SystemExit(2)

    ks = [r["new_k"] for r in ok]
    print(f"\n=== 打ち切り無しの k（再取得できた {len(ok)} 店）===", file=sys.stderr)
    print(f"  平均 **{statistics.mean(ks):.2f}** / 中央 {statistics.median(ks)} / "
          f"最大 {max(ks)}", file=sys.stderr)
    c = collections.Counter(ks)
    for k in sorted(c):
        print(f"   {k:>2} 枚: {c[k]:>3} 店", file=sys.stderr)

    n_cap30 = sum(1 for r in ok if r["n_verified"] >= ownsite.MAX_VERIFY_PER_SITE)
    print(f"\n  **新しい上限 {ownsite.MAX_VERIFY_PER_SITE} に張り付いた店 "
          f"{n_cap30}**（0 でなければまだ打ち切られている）", file=sys.stderr)

    n_need = sum(1 for x in ks if x >= K_NEEDED_URBAN_1KM)
    print(f"\n=== KPI②（都市1km で要る k = {K_NEEDED_URBAN_1KM}）===", file=sys.stderr)
    print(f"  満たす店 **{n_need}/{len(ok)} = {n_need/len(ok)*100:.2f}%**",
          file=sys.stderr)

    cats = [r["distinct_categories"] for r in ok]
    print(f"\n=== ただし distinct な料理カテゴリ数 ===", file=sys.stderr)
    print(f"  平均 **{statistics.mean(cats):.2f}** / 最大 {max(cats)}", file=sys.stderr)
    print(f"  **枚数ではなくカテゴリで見ると k はここまで落ちる。**"
          f"KPI② が要求するのはこちらである。", file=sys.stderr)
    n_need_cat = sum(1 for x in cats if x >= K_NEEDED_URBAN_1KM)
    print(f"  カテゴリで {K_NEEDED_URBAN_1KM} を満たす店 "
          f"**{n_need_cat}/{len(ok)} = {n_need_cat/len(ok)*100:.2f}%**", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "own_site_k_uncapped.json"
    p.write_text(json.dumps({
        "cap_used": ownsite.MAX_VERIFY_PER_SITE,
        "n_target": len(covered), "n_refetched": len(ok),
        "old_k_mean": statistics.mean(old_ks), "old_k_max": max(old_ks),
        "n_censored_at_5_in_old_data": n_at_cap,
        "new_k_mean": statistics.mean(ks), "new_k_median": statistics.median(ks),
        "new_k_max": max(ks), "new_k_hist": {str(k): v for k, v in sorted(c.items())},
        "n_at_new_cap": n_cap30,
        "k_needed_urban_1km": K_NEEDED_URBAN_1KM,
        "n_meeting_k_by_images": n_need,
        "distinct_category_mean": statistics.mean(cats),
        "distinct_category_max": max(cats),
        "n_meeting_k_by_categories": n_need_cat,
        "rows": rows,
        "caveat": "上限 30 も上限である（張り付き数を併記した）。"
                  "『料理画像5枚』＝『5つの別カテゴリ』ではないので、"
                  "KPI② の判定には distinct カテゴリ数の方を使うこと。"
                  "元の測定から日が経っており、サイト側が変わっている可能性がある。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
