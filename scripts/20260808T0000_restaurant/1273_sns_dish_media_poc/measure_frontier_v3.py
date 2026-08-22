#!/usr/bin/env python3
"""#1273 Facebook 経路を入れても 70% に届くのか（¥60,000 を払う価値の計算）

## なぜ

`measure_env_corrected_ceiling.py` が出した実効天井 **19.26〜25.63%** は、
**Facebook（socials のみの層）経路を勘定に入れていない**。
その後に測った Facebook 経路は経路存在率 25.87pt（生存率込み 25.35pt）で、
**これまで測ったどの単独経路よりも大きい**。

オーナーが判断するのは「法人登記 ¥60,000 + App Review を、歩留まり未知のまま
先に払うか」である。**払った先に 70% があるのかどうか**を先に出しておく。
無いなら、その ¥60,000 は 70% のためには払えない（別の理由でなら払える）。

## 測るもの（新しい実測ではなく、実測値の合成）

  1. `measure_env_corrected_ceiling.py` と**同じ式・同じ定数**で天井を引き直す
  2. そこに Facebook 経路を**重なりを引いて**足す
  3. 70% との差を出す

**この節に新しい実測は無い。** 既に測った値だけを組み合わせる。
その代わり、どの数字がどの測定から来たかを全部書き出す。

## 重なりの扱い（ここが結果を左右する）

Facebook 経路の対象は **socials のみ（website 無し）× Facebook = 299,825店**。

  - **自社サイト経路とは重ならない**。website を持たない層の定義そのものだから
  - **YouTube 経路とは重なる**。YouTube は店名で当てるのでリンクの有無に依らない
    （実測: リンクあり 26.67% / リンク無し 26.00% で差がつかない）
    → この層の中で `1 - (1 - fb) * (1 - yt)` として合成する

## この計算が言えないこと

  - **料理写真率が未実測**である。承認前は原理的に測れない（#1356）。
    ここでは近い実測2つ（自社サイト 67.32% / ブログ 28.6%）を**幅として当てる**。
    **これは推定であって実測ではない**
  - 層のシェアは 1,132,482 母集団、frontier_v2 は 1,159,183 母集団で、
    リリース差の 2.3% ぶんずれている。**結論の桁は変わらない**
  - App Review が通る前提の計算である

実行:
    python3 measure_frontier_v3.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# --- measure_env_corrected_ceiling.py と同じ定数（意図的に複製し、出典を書く）---
POP = 1_132_482                       # measure_seed_population.py
SHARE_LINK = 789_235 / POP
SHARE_LINKLESS = 343_247 / POP
OWN_SITE_PRECISION = (0.467, 0.750)   # 独立店 / チェーン
OWN_SITE_CATEGORY = 0.767
OWN_SITE_DISH_IMAGE = (0.1717, 0.2909)  # 補正シナリオ A / C（600店標本に写した値）
YT_PATH = 0.2733
YT_CATEGORY = 0.500
LINKLESS_EFFECTIVE = 0.1993
OWNER_TARGET = 0.70

# --- Facebook 経路（新しく足す項）---------------------------------------
FB_STORES = 299_825                   # BigQuery overture_maps.place（socials のみ × facebook）
FB_LIVENESS = 0.980                   # out/overture_facebook_link.json（294/300、負性対照3件は全て dead）
# 料理写真率は**未実測**。近い実測2つを幅として当てる。
FB_DISH_RATE = (0.286, 0.6732)        # ブログ本文 28.6% / 自社サイト 67.32%
FB_CATEGORY = (0.500, 0.767)          # YouTube 実測 50.0% / 自社サイト実測 76.7%


def main() -> None:
    yt_eff = YT_PATH * YT_CATEGORY
    fb_share = FB_STORES / POP * FB_LIVENESS

    print(f"=== 入力（全部が既測。出典はソース上部）===", file=sys.stderr)
    print(f"  母集団 {POP:,} / リンク層 {SHARE_LINK*100:.2f}% / "
          f"リンク無し層 {SHARE_LINKLESS*100:.2f}%", file=sys.stderr)
    print(f"  YouTube 実効 {yt_eff*100:.2f}%（経路 27.33% × カテゴリ 50.0%）",
          file=sys.stderr)
    print(f"  **Facebook 層 {FB_STORES:,}店 = 母集団の {FB_STORES/POP*100:.2f}%"
          f" / 生存率 {FB_LIVENESS*100:.1f}% → {fb_share*100:.2f}%**", file=sys.stderr)

    rows = []
    for own_img in OWN_SITE_DISH_IMAGE:
        for prec in OWN_SITE_PRECISION:
            own_eff = own_img * prec * OWN_SITE_CATEGORY
            link_eff = 1 - (1 - own_eff) * (1 - yt_eff)
            base = link_eff * SHARE_LINK + LINKLESS_EFFECTIVE * SHARE_LINKLESS
            for dish in FB_DISH_RATE:
                for cat in FB_CATEGORY:
                    fb_eff = dish * cat
                    # socials のみ層の中で YouTube と合成し、YouTube 分は既に
                    # base に入っているので**純増だけ**を足す
                    fb_net = fb_share * fb_eff * (1 - yt_eff)
                    rows.append({
                        "own_site_dish_image": own_img, "own_site_precision": prec,
                        "fb_dish_rate": dish, "fb_category_rate": cat,
                        "base_ceiling": base, "fb_net_pt": fb_net,
                        "ceiling_with_fb": base + fb_net,
                    })

    base_lo = min(r["base_ceiling"] for r in rows)
    base_hi = max(r["base_ceiling"] for r in rows)
    lo = min(r["ceiling_with_fb"] for r in rows)
    hi = max(r["ceiling_with_fb"] for r in rows)
    fb_lo = min(r["fb_net_pt"] for r in rows)
    fb_hi = max(r["fb_net_pt"] for r in rows)

    print(f"\n=== 天井 ===", file=sys.stderr)
    print(f"  Facebook 経路**なし**（現状の公表値） "
          f"**{base_lo*100:.2f}% 〜 {base_hi*100:.2f}%**", file=sys.stderr)
    print(f"  Facebook 経路の純増                  "
          f"**+{fb_lo*100:.2f}pt 〜 +{fb_hi*100:.2f}pt**", file=sys.stderr)
    print(f"  Facebook 経路**あり**                "
          f"**{lo*100:.2f}% 〜 {hi*100:.2f}%**", file=sys.stderr)

    print(f"\n=== 70% との差 ===", file=sys.stderr)
    print(f"  最良の場合でも **{(OWNER_TARGET - hi)*100:.2f}pt 不足**",
          file=sys.stderr)
    print(f"  最悪の場合は   **{(OWNER_TARGET - lo)*100:.2f}pt 不足**",
          file=sys.stderr)

    # 逆算: Facebook 経路が 70% を単独で埋めるには何%の料理写真率が要るか
    need = (OWNER_TARGET - base_hi) / (fb_share * (1 - yt_eff))
    print(f"\n=== 逆算 ===", file=sys.stderr)
    print(f"  Facebook 経路だけで 70% に届かせるには、"
          f"**料理写真率 × カテゴリ付与率 = {need*100:.1f}% が必要**",
          file=sys.stderr)
    print(f"  （100% を超えるなら、**この層を全部完璧に取り込んでも届かない**）",
          file=sys.stderr)
    if need > 1.0:
        print(f"  → **{need*100:.1f}% > 100%。届かない。**", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "frontier_v3.json"
    p.write_text(json.dumps({
        "pop": POP, "share_link": SHARE_LINK, "share_linkless": SHARE_LINKLESS,
        "yt_effective": yt_eff,
        "fb_stores": FB_STORES, "fb_liveness": FB_LIVENESS,
        "fb_share_of_pop_after_liveness": fb_share,
        "fb_dish_rate_assumed": FB_DISH_RATE,
        "fb_category_rate_assumed": FB_CATEGORY,
        "ceiling_without_fb": [base_lo, base_hi],
        "fb_net_pt": [fb_lo, fb_hi],
        "ceiling_with_fb": [lo, hi],
        "gap_to_target_pt": [(OWNER_TARGET - hi) * 100, (OWNER_TARGET - lo) * 100],
        "fb_rate_required_to_close_alone": need,
        "rows": rows,
        "caveat": "新しい実測は無い。既測値の合成である。Facebook の料理写真率は"
                  "**未実測**で、近い実測2つ（ブログ 28.6% / 自社サイト 67.32%）を"
                  "幅として当てただけ。App Review が通る前提の計算である。"
                  "層のシェアは 1,132,482 母集団で、frontier_v2 の 1,159,183 とは"
                  "リリース差の 2.3% ずれる。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
