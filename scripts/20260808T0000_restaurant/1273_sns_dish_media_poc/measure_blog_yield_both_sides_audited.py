#!/usr/bin/env python3
"""#1344 特化 vs 非特化を**両側とも目視補正して**比べ直す

## なぜ

前に「特化ブロガーは店数 2.16倍」と出したとき、

    特化群 …… 4ブログ 94件を目視して precision 77.7%。**割り引いた**
    非特化群 … **目視していない**。機械判定の 12.5 店/人をそのまま使った

としていた。REPORT にも「非特化群の precision は測っていないので、この比較は
特化側だけ厳しくしている」と書いた。**片側だけ厳しくした比較は比較ではない**ので、
非特化側も目視した。

## 測ったもの

非特化6ブログのうち、店名を当てた数の多い2件を目視した。
この2件で非特化群の店名の **93.3%（70/75）** を占める。

    kiyosuke.blog.jp       30件中 判定できた28件 → precision **25.0%**
    aktryman.blogspot.com  17件                → precision **82.4%**

## この計算が言えないこと

  - 非特化の残り4ブログ（計5店）は**目視していない**。補正せずそのまま足す
  - 特化群も4/8ブログしか目視していない
  - **経路存在率**である。店名が書いてあることと、その写真を使えることは別

実行:
    python3 measure_blog_yield_both_sides_audited.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

FOCUSED_PRECISION = 0.7766          # 73/94（4ブログ合算、既測）
UNMEASURED_GENERAL = 5              # convenicheck 3 + ltozuka 2（目視していない）


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def main() -> None:
    y = json.loads((OUT_DIR / "blog_yield_by_focus_focused_dishcat.json").read_text(encoding="utf-8"))
    g = json.loads((OUT_DIR / "blog_yield_by_focus_general.json").read_text(encoding="utf-8"))
    ki = json.loads((OUT_DIR / "blog_match_labels_kiyosuke.json").read_text(encoding="utf-8"))
    ak = json.loads((OUT_DIR / "blog_match_labels_aktryman.json").read_text(encoding="utf-8"))

    f, gen = y["focused"], g["general"]
    ki_n, ak_n = ki["n_stores_strict_reported"], ak["n_stores_strict_reported"]

    print("=== 非特化群の precision（今回はじめて測った）===", file=sys.stderr)
    tp = ki["counts"]["tp"] + ak["counts"]["tp"]
    n = ki["counts"]["n_judged"] + ak["counts"]["n_judged"]
    lo, hi = wilson(tp, n)
    for d in (ki, ak):
        l2, h2 = wilson(d["counts"]["tp"], d["counts"]["n_judged"])
        print(f"  {d['domain']:26} {d['counts']['tp']:>2}/{d['counts']['n_judged']:<2} = "
              f"**{d['precision']*100:5.1f}%**  95%CI {l2*100:.1f}〜{h2*100:.1f}%",
              file=sys.stderr)
    print(f"  {'合算':26} {tp:>2}/{n:<2} = **{tp/n*100:5.1f}%**  "
          f"95%CI {lo*100:.1f}〜{hi*100:.1f}%", file=sys.stderr)
    print("  ※ 2件の CI は重ならない。**同じ群の中で precision が割れている**", file=sys.stderr)

    # 店単位の補正は、目視したブログごとの precision をその店数に掛ける
    gen_corrected = ki_n * ki["precision"] + ak_n * ak["precision"] + UNMEASURED_GENERAL
    foc_corrected = f["sum_stores"] * FOCUSED_PRECISION

    print("\n=== 両側を補正した distinct 店数 ===", file=sys.stderr)
    print(f"  {'':22}{'機械判定':>10}{'補正後':>10}{'店/人':>9}", file=sys.stderr)
    print(f"  特化   （{f['n_blogs']}ブログ）    {f['sum_stores']:>10}"
          f"{foc_corrected:>10.1f}{foc_corrected/f['n_blogs']:>9.2f}", file=sys.stderr)
    print(f"  非特化 （{gen['n_blogs']}ブログ）    {gen['sum_stores']:>10}"
          f"{gen_corrected:>10.1f}{gen_corrected/gen['n_blogs']:>9.2f}", file=sys.stderr)

    before = (f["sum_stores"] / f["n_blogs"]) / (gen["sum_stores"] / gen["n_blogs"])
    after = (foc_corrected / f["n_blogs"]) / (gen_corrected / gen["n_blogs"])
    print(f"\n  倍率 **{before:.2f}倍 → {after:.2f}倍**", file=sys.stderr)
    print("  **両側を補正したら、オーナーの見立てはむしろ強まった。**"
          "\n  片側だけ割り引いていたので、特化の優位を**過小に**言っていた。", file=sys.stderr)

    print("\n=== 誤爆はリンク無し層に偏っているか（今回の標本で数えた）===", file=sys.stderr)
    print("  真陽性 17 件中 リンク無し **2 件 = 11.8%**", file=sys.stderr)
    print("  偽陽性 24 件中 リンク無し **6 件 = 25.0%**", file=sys.stderr)
    l1, h1 = wilson(2, 17)
    l2, h2 = wilson(6, 24)
    print(f"  95%CI {l1*100:.1f}〜{h1*100:.1f}% と {l2*100:.1f}〜{h2*100:.1f}% で"
          f"**大きく重なる**。向きは r_N の監査と同じ（誤爆がリンク無し側に寄る）だが、"
          f"\n  **この n では差を主張できない**。倍率の補正には使わない。", file=sys.stderr)

    p = OUT_DIR / "blog_yield_both_sides_audited.json"
    p.write_text(json.dumps({
        "focused": {"n_blogs": f["n_blogs"], "raw": f["sum_stores"],
                    "precision": FOCUSED_PRECISION, "corrected": foc_corrected,
                    "per_blogger": foc_corrected / f["n_blogs"]},
        "general": {"n_blogs": gen["n_blogs"], "raw": gen["sum_stores"],
                    "per_blog_precision": {ki["domain"]: ki["precision"],
                                           ak["domain"]: ak["precision"]},
                    "unmeasured_stores": UNMEASURED_GENERAL,
                    "corrected": gen_corrected,
                    "per_blogger": gen_corrected / gen["n_blogs"]},
        "ratio_before": before, "ratio_after": after,
        "general_precision_pooled": {"tp": tp, "n": n, "p": tp / n, "ci": [lo, hi]},
        "nolink_among_tp": {"k": 2, "n": 17}, "nolink_among_fp": {"k": 6, "n": 24},
        "caveat": "経路存在率。非特化の残り4ブログ（5店）は目視していないので補正せず"
                  "そのまま足した（非特化に甘い側）。特化も4/8ブログしか目視していない。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
