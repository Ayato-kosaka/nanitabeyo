#!/usr/bin/env python3
"""#1273 3つの面を全部監査したあとの r_N（リンク無し層の到達率）を組み直す

## なぜ

r_N を構成する3経路のヒットを**全件目視**した。3つとも同じ判定器
（`measure_supply_ceiling`。3文字以上の店名に地名の裏取りを課さない）を使っており、
リンク無し層は locality が 32.7% 欠損しているので裏取りも効かない。

    YouTube  機械 25.33% → precision 21.1〜34.2% → **5.34〜8.66%**
    Misskey  機械 12.67% → precision 26.3〜52.6% → **3.33〜6.67%**
    Bluesky  機械 13.33% → precision 15.0〜30.0% → **2.00〜4.00%**

**同じ屋号が3つの面すべてで誤爆している**（あかつき＝桃 / ムーラン / 世界の山ちゃん など）。
原因は面ではなく店名辞書である。

## 測るもの（新しい取得はしない）

目視ラベル（`out/*_labels.json` / `out/misskey_hit_review.json`）だけを使って、

  1. 偽陽性を除いた **r_N の経路存在率**
  2. 到達可能性の恒等式から逆算した **70% に要る r_L**
  3. 実測の r_L 上限（38.20%）との差

## この計算が言えないこと

  - **経路存在率であって実効ではない。** 料理が写っているか・カテゴリが付くかは別。
    実効はここからさらに落ちる
  - 独立仮定の union なので**上限側**である
  - 厳格／緩いの2通りを出す。厳格は「サンプルしたその店」、
    緩いは「その屋号の店（チェーンの別店舗を含む）」

実行:
    python3 measure_rn_after_audit.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

W_LINK = 789_235 / 1_132_482
W_NOLINK = 343_247 / 1_132_482
OWNER_TARGET = 0.70
R_L_MEASURED_MAX = 0.3820          # 自社サイト経路の実測上限（#1273）

# 監査の結果（機械判定率, 厳格 precision, 緩い precision）
ROUTES = {
    "YouTube": (0.2533, 0.2105, 0.3421),
    "Misskey": (0.1267, 0.2632, 0.5263),
    "Bluesky": (0.1333, 0.1500, 0.3000),
}
# 監査前に公表していた値（経路存在率）
BEFORE = {"YouTube": 0.2533, "Misskey": 0.1267, "Bluesky": None}


def union(rates: list[float]) -> float:
    u = 1.0
    for r in rates:
        u *= (1 - r)
    return 1 - u


def required_r_l(r_n: float) -> float:
    return (OWNER_TARGET - W_NOLINK * r_n) / W_LINK


def main() -> None:
    print(f"母集団の重み: リンク層 {W_LINK*100:.2f}% / リンク無し層 {W_NOLINK*100:.2f}%",
          file=sys.stderr)

    print(f"\n=== 経路ごと（目視で偽陽性を除いた）===", file=sys.stderr)
    strict, loose = [], []
    for name, (raw, p_s, p_l) in ROUTES.items():
        s, l = raw * p_s, raw * p_l
        strict.append(s)
        loose.append(l)
        b = BEFORE.get(name)
        bs = f"{b*100:5.2f}%" if b else "  未測定"
        print(f"  {name:8} 機械 {raw*100:5.2f}%  → 厳格 **{s*100:4.2f}%** / "
              f"緩い **{l*100:4.2f}%**   （監査前の公表値 {bs}）", file=sys.stderr)

    u_before = union([v for v in BEFORE.values() if v])
    u_s, u_l = union(strict), union(loose)
    print(f"\n=== r_N（独立仮定の union＝上限）===", file=sys.stderr)
    print(f"  監査前（YouTube+Misskey）      **{u_before*100:5.2f}%**", file=sys.stderr)
    print(f"  監査後 厳格（3経路）           **{u_s*100:5.2f}%**", file=sys.stderr)
    print(f"  監査後 緩い（3経路）           **{u_l*100:5.2f}%**", file=sys.stderr)
    print(f"  → **Bluesky を1経路足してもなお、監査前より "
          f"{(u_before-u_l)*100:.2f}〜{(u_before-u_s)*100:.2f}pt 低い**", file=sys.stderr)

    print(f"\n=== 70% に要るリンク層カバレッジ r_L ===", file=sys.stderr)
    for lab, rn in (("監査前", u_before), ("監査後 緩い", u_l), ("監査後 厳格", u_s)):
        need = required_r_l(rn)
        print(f"  {lab:12} r_N={rn*100:5.2f}% → r_L 必要 **{need*100:5.2f}%**"
              f"（実測上限 {R_L_MEASURED_MAX*100:.2f}% との差 "
              f"{(need-R_L_MEASURED_MAX)*100:5.2f}pt）", file=sys.stderr)

    # モデルの内部矛盾: 実効値が補正後の経路存在率を超えていないか
    LINKLESS_EFFECTIVE_MODEL = 0.1993
    print(f"\n=== モデルの整合性 ===", file=sys.stderr)
    print(f"  天井の式が使っている『リンク無し層の実効』 "
          f"**{LINKLESS_EFFECTIVE_MODEL*100:.2f}%**", file=sys.stderr)
    print(f"  監査後の**経路存在率**            厳格 {u_s*100:.2f}% / 緩い {u_l*100:.2f}%",
          file=sys.stderr)
    if LINKLESS_EFFECTIVE_MODEL > u_s:
        print(f"  → **実効が経路存在率を上回っている。厳格側ではモデルが成り立たない。**",
              file=sys.stderr)
        print(f"     （実効 ≤ 経路存在率 でなければならない）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "rn_after_audit.json"
    p.write_text(json.dumps({
        "weights": {"link": W_LINK, "nolink": W_NOLINK},
        "routes": {k: {"machine": v[0], "precision_strict": v[1],
                       "precision_loose": v[2],
                       "corrected_strict": v[0] * v[1], "corrected_loose": v[0] * v[2]}
                   for k, v in ROUTES.items()},
        "r_n_before": u_before, "r_n_after_strict": u_s, "r_n_after_loose": u_l,
        "r_l_required_before": required_r_l(u_before),
        "r_l_required_after_strict": required_r_l(u_s),
        "r_l_required_after_loose": required_r_l(u_l),
        "r_l_measured_max": R_L_MEASURED_MAX,
        "model_linkless_effective": LINKLESS_EFFECTIVE_MODEL,
        "model_inconsistent_strict": LINKLESS_EFFECTIVE_MODEL > u_s,
        "caveat": "経路存在率であって実効ではない（実効はここからさらに落ちる）。"
                  "独立仮定の union なので上限側。厳格は『サンプルしたその店』、"
                  "緩いは『その屋号の店（チェーンの別店舗を含む）』。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
