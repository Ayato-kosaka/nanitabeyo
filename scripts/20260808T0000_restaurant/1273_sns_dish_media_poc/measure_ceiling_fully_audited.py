#!/usr/bin/env python3
"""#1273 両側を監査したあとの天井を引き直す

## なぜ

これまで公表してきた天井 **19.84〜25.30%** は、両側とも**機械判定のまま**だった。
今回、r_N（リンク無し層）と r_L（リンク層）の両方を目視監査した。

    r_N: 3面すべてのヒットを目視 → 34.79% → **3.12%**（名前で一意に特定できる店のみ）
    r_L: 自社サイトの「料理画像」を実際に表示 → **店単位 precision 54.84%**（17/31）

**【訂正 8/19】** 以前ここに書いていた 75.0% は **n=8** の値だった。天井の幅
（12.22〜19.52%）を決めていたのがこの CI（40.9〜92.9%）だったので、標本を
32 店に広げて測り直したところ **54.84%（17/31、95%CI 37.8〜70.8%）** になった。
前8件（75.0%）と新23件（47.8%）は CI が大きく重なるので**差があるとは言えず**、
75.0% は小標本の上振れだったと見るのが素直である。定数と本文の両方を直した。

**片側だけ厳しく見ると天井が歪む**ので、両方を入れて引き直す。

## 測るもの（新しい取得はしない）

`measure_ceiling_after_recovery.py` と**同じ式・同じ定数**で、
次の2点だけを監査後の値に差し替える。

  1. リンク無し層の実効: 19.93% → **3.12%**（監査後の経路存在率。実効はこれ以下）
  2. 自社サイトの料理画像率に**店単位 precision 54.84%** を掛ける

4通り（監査前/後 × 補正あり/なし）を並べて、**どちらの監査がどれだけ効いたか**を出す。

## この計算が言えないこと

  - 店単位 precision は **n=31**（95%CI 37.8〜70.8%）。まだ幅は広い
  - r_N は経路存在率であって実効ではないので、3.12% を実効として使うのは**甘い側**
  - 独立仮定の union を含むので上限側

実行:
    python3 measure_ceiling_fully_audited.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

SHARE_LINK = 789_235 / 1_132_482
SHARE_LINKLESS = 343_247 / 1_132_482
OWN_SITE_PRECISION = (0.467, 0.750)     # 店舗マッチの precision（独立店/チェーン）
OWN_SITE_CATEGORY = 0.767
YT_EFF = 0.2733 * 0.500
OWNER_TARGET = 0.70

R_N_BEFORE = 0.1993                      # 従来モデルの「リンク無し層の実効」
R_N_AFTER = 0.0312                       # 監査後の経路存在率（out/rn_decomposition.json）
# #1273 【訂正 8/19】n=8 の 0.750 から n=31 の 0.5484 に差し替えた。
#   標本を4倍にしたら点推定が 20.2pt 下がった（out/own_site_by_store_labels_n32.json）。
#   偽 12 件のうち **6 件は『別主体のサイト』**（乃が美・Francfranc・弘前観光協会など）で、
#   これは画像判定ではなく **website 列の質**の問題である。
STORE_PRECISION = 0.5484                 # 店単位の目視 precision（17/31）
STORE_PRECISION_CI = (0.378, 0.708)
STORE_PRECISION_OLD = 0.750              # 旧値（6/8）。比較のために残す


def ceiling(own_img_of600: float, r_n: float) -> tuple[float, float]:
    vals = []
    for prec in OWN_SITE_PRECISION:
        own = own_img_of600 * prec * OWN_SITE_CATEGORY
        link = 1 - (1 - own) * (1 - YT_EFF)
        vals.append(link * SHARE_LINK + r_n * SHARE_LINKLESS)
    return min(vals), max(vals)


def main() -> None:
    env = json.loads((OUT_DIR / "env_corrected_ceiling.json").read_text(encoding="utf-8"))
    rec = json.loads((OUT_DIR / "own_site_root_recovery.json").read_text(encoding="utf-8"))
    n_site, n_sample = env["n_with_website"], env["n_sample"]
    n_dish = env["n_with_dish_image"]
    den = env["denominators"]
    den_a = den["A 無補正（取れなかった店は全部「画像が無い」）"]
    den_c = den["C amb も env 扱い（ゲートウェイ拒否は403/urlerror/dnsに化ける）"]
    got, got_dish = rec["n_recovered_page"], rec["n_recovered_with_dish"]

    rows = []
    print("=== 天井（4通り）===", file=sys.stderr)
    for rn_label, rn in (("監査前 19.93%", R_N_BEFORE), ("**監査後 3.12%**", R_N_AFTER)):
        for sp_label, sp in (("補正なし", 1.0), ("**店単位 54.8%**", STORE_PRECISION)):
            vals = []
            for d_after in (den_a, den_c + got):
                of600 = (n_dish + got_dish) / d_after * (n_site / n_sample) * sp
                lo, hi = ceiling(of600, rn)
                vals += [lo, hi]
            rows.append({"r_n": rn_label, "store_precision": sp_label,
                         "low": min(vals), "high": max(vals)})
            print(f"  r_N={rn_label:16} / 画像 {sp_label:16} → "
                  f"**{min(vals)*100:5.2f}% 〜 {max(vals)*100:5.2f}%**", file=sys.stderr)

    full = rows[-1]
    base = rows[0]
    print(f"\n=== 両側を監査した天井 ===", file=sys.stderr)
    print(f"  監査前 **{base['low']*100:.2f}% 〜 {base['high']*100:.2f}%**", file=sys.stderr)
    print(f"  監査後 **{full['low']*100:.2f}% 〜 {full['high']*100:.2f}%**", file=sys.stderr)
    print(f"  下がった幅 **{(base['low']-full['low'])*100:.2f}pt 〜 "
          f"{(base['high']-full['high'])*100:.2f}pt**", file=sys.stderr)
    print(f"\n  **70% との差 {(OWNER_TARGET-full['high'])*100:.2f}pt 〜 "
          f"{(OWNER_TARGET-full['low'])*100:.2f}pt**", file=sys.stderr)

    # 店単位 precision の CI を振ったときの幅
    print(f"\n=== 店単位 precision の CI で振る（n=31。旧 n=8 の値も並べる）===", file=sys.stderr)
    for lab, sp in (("CI 下端 37.8%", STORE_PRECISION_CI[0]),
                    ("点推定 54.8%", STORE_PRECISION),
                    ("CI 上端 70.8%", STORE_PRECISION_CI[1]),
                    ("旧 n=8 の 75.0%", STORE_PRECISION_OLD)):
        vals = []
        for d_after in (den_a, den_c + got):
            of600 = (n_dish + got_dish) / d_after * (n_site / n_sample) * sp
            lo, hi = ceiling(of600, R_N_AFTER)
            vals += [lo, hi]
        print(f"  {lab:14} → 天井 **{min(vals)*100:5.2f}% 〜 {max(vals)*100:5.2f}%**",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "ceiling_fully_audited.json"
    p.write_text(json.dumps({
        "rows": rows, "ceiling_before": [base["low"], base["high"]],
        "ceiling_after": [full["low"], full["high"]],
        "gap_to_target_pt": [(OWNER_TARGET - full["high"]) * 100,
                             (OWNER_TARGET - full["low"]) * 100],
        "r_n_before": R_N_BEFORE, "r_n_after": R_N_AFTER,
        "store_precision": STORE_PRECISION, "store_precision_ci": STORE_PRECISION_CI,
        "store_precision_n": 31,
        "store_precision_old_n8": STORE_PRECISION_OLD,
        "caveat": "店単位 precision は n=31（95%CI 37.8〜70.8%）。旧値は n=8 の 75.0%。"
                  "r_N は経路存在率であって実効ではないので 3.12% を実効に使うのは甘い側。"
                  "独立仮定の union を含むので上限側である。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
