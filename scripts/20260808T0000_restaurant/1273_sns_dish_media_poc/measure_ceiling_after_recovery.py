#!/usr/bin/env python3
"""#1273 取得できなかった 123 店を回収した後の天井を引き直す

## なぜ

天井 **19.26% 〜 25.63%** の 6.4pt の幅は、**自社サイトの取得失敗**が正体だった。
305 店中 153 店しか取れておらず、残りを「画像が無い」と数えるか
分母から外すかで両端が決まっていた。**推定でしかなかった 6.4pt を、実測で潰す。**

`measure_own_site_root_recovery.py` で 123 店をドメイン根から取り直した結果:

    回収できた 35 店 / うち料理画像あり 16 店
    env_http80_blocked(https_err=http_404)  25/29 = 86.2% 回収
    env_http80_blocked(https_err=ssl)        0/19 = 0%（平文HTTPのみのサイト）

## 測るもの

`measure_env_corrected_ceiling.py` と**同じ式・同じ定数**で、
分子と分母だけを回収後の実測値に差し替える。

  - **シナリオA**（未取得は全部「画像無し」）… 分子が +16 される
  - **シナリオC**（判定不能を分母から外す）… 分母が +35、分子が +16 される。
    回収した 35 店の料理画像率は 45.7% で、C が仮定していた 57.2% より低い。
    **つまり C は楽観側に外れていた。** 実測で下がる

## この計算が言えないこと

  - `env_corrected` の料理画像判定は `own-website-images.py` より緩く、
    同じ 305 店で 103 店 vs 92 店と数えている。回収分の +16 は**厳しい方の規則**で
    数えたので、緩い規則なら 16 以上になりうる。**+16 は下限**である
  - 平文HTTPのみのサイト（ssl 19 件）は**この環境では永久に測れない**

実行:
    python3 measure_ceiling_after_recovery.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# measure_env_corrected_ceiling.py と同じ定数
SHARE_LINK = 789_235 / 1_132_482
SHARE_LINKLESS = 343_247 / 1_132_482
OWN_SITE_PRECISION = (0.467, 0.750)
OWN_SITE_CATEGORY = 0.767
YT_PATH, YT_CATEGORY = 0.2733, 0.500
LINKLESS_EFFECTIVE = 0.1993
OWNER_TARGET = 0.70


def ceiling(own_img: float, prec: float) -> float:
    own_eff = own_img * prec * OWN_SITE_CATEGORY
    yt_eff = YT_PATH * YT_CATEGORY
    link_eff = 1 - (1 - own_eff) * (1 - yt_eff)
    return link_eff * SHARE_LINK + LINKLESS_EFFECTIVE * SHARE_LINKLESS


def main() -> None:
    env = json.loads((OUT_DIR / "env_corrected_ceiling.json").read_text(encoding="utf-8"))
    rec = json.loads((OUT_DIR / "own_site_root_recovery.json").read_text(encoding="utf-8"))

    n_site = env["n_with_website"]                 # 305
    n_sample = env["n_sample"]                     # 600
    n_dish = env["n_with_dish_image"]              # 103
    den = env["denominators"]
    den_a = den["A 無補正（取れなかった店は全部「画像が無い」）"]
    den_c = den["C amb も env 扱い（ゲートウェイ拒否は403/urlerror/dnsに化ける）"]

    got = rec["n_recovered_page"]                  # 35
    got_dish = rec["n_recovered_with_dish"]        # 16

    print(f"=== 回収の実測 ===", file=sys.stderr)
    print(f"  未解決 {rec['n_unresolved']} 店 → 根から取れた **{got}** 店 "
          f"({rec['recovery_rate']*100:.1f}%)", file=sys.stderr)
    print(f"  うち料理画像あり **{got_dish}** 店 "
          f"({rec['dish_rate_among_recovered']*100:.1f}%)", file=sys.stderr)

    rows = []
    for label, d_before, d_after in (("A 無補正", den_a, den_a),
                                     ("C 判定不能を除外", den_c, den_c + got)):
        r_before = n_dish / d_before
        r_after = (n_dish + got_dish) / d_after
        of600_b = r_before * (n_site / n_sample)
        of600_a = r_after * (n_site / n_sample)
        for prec in OWN_SITE_PRECISION:
            rows.append({"scenario": label, "precision": prec,
                         "before": ceiling(of600_b, prec),
                         "after": ceiling(of600_a, prec)})
        print(f"\n  [{label}] 料理画像 {n_dish}/{d_before} = {r_before*100:.2f}%"
              f"  →  {n_dish+got_dish}/{d_after} = **{r_after*100:.2f}%**",
              file=sys.stderr)

    b_lo = min(r["before"] for r in rows)
    b_hi = max(r["before"] for r in rows)
    a_lo = min(r["after"] for r in rows)
    a_hi = max(r["after"] for r in rows)

    print(f"\n=== 天井 ===", file=sys.stderr)
    print(f"  回収前 **{b_lo*100:.2f}% 〜 {b_hi*100:.2f}%**（幅 {(b_hi-b_lo)*100:.2f}pt）",
          file=sys.stderr)
    print(f"  回収後 **{a_lo*100:.2f}% 〜 {a_hi*100:.2f}%**（幅 {(a_hi-a_lo)*100:.2f}pt）",
          file=sys.stderr)
    shrink = ((b_hi - b_lo) - (a_hi - a_lo)) * 100
    print(f"  → 幅は **{abs(shrink):.2f}pt {'縮んだ' if shrink > 0 else '広がった'}**、"
          f"下端 {(a_lo-b_lo)*100:+.2f}pt / 上端 {(a_hi-b_hi)*100:+.2f}pt",
          file=sys.stderr)
    print(f"\n  70% との差 **{(OWNER_TARGET-a_hi)*100:.2f}pt 〜 "
          f"{(OWNER_TARGET-a_lo)*100:.2f}pt**", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "ceiling_after_recovery.json"
    p.write_text(json.dumps({
        "n_recovered": got, "n_recovered_with_dish": got_dish,
        "ceiling_before": [b_lo, b_hi], "ceiling_after": [a_lo, a_hi],
        "band_before_pt": (b_hi - b_lo) * 100, "band_after_pt": (a_hi - a_lo) * 100,
        "gap_to_target_pt": [(OWNER_TARGET - a_hi) * 100, (OWNER_TARGET - a_lo) * 100],
        "rows": rows,
        "caveat": "回収分 +16 は own-website-images.py の厳しい判定で数えたので、"
                  "env_corrected の緩い判定なら 16 以上になりうる（**下限**）。"
                  "平文HTTPのみのサイト（ssl 19件）はこの環境では永久に測れない。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
