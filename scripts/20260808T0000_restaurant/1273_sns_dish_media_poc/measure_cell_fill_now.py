#!/usr/bin/env python3
"""#1273 §32 のセル充足を、いまの実測値で計算し直す

## なぜ

要求① は「全店の 70% に dish_media」だが、**プロダクトの実感は §32 の
「1エリア×1カテゴリに distinct 5店」**である。この2つは別の指標で、
片方を満たしても他方を満たすとは限らない。**どれだけ別の話なのかを数字で出す。**

これは要求を下げる提案ではない。オーナーが判断するための材料である。

## 使う実測値（全て既に測ったもの。ここでは新しい測定をしない）

| 値 | 出典 |
|---|---|
| 密度（半径1km内の母集団店舗数）urban 197.54 / suburban 27.45 / rural 5.66 | #1319 R8-B の密度センサス |
| 写真経由: カバレッジ 13.17% / k 1.89 | measure_menu_text_route.py |
| 店名∪サイト本文（dish 行）: 41.17% / k 1.91 | measure_dish_row_union.py |
| 実効天井: 19.26–25.63% | measure_env_corrected_ceiling.py |
| カテゴリ数 134 | fixtures/public_dish_categories_134_gate.csv |

## 計算

1セル×1カテゴリの期待店舗数を

    λ = セル内の母集団店舗数 × カバレッジ × (k / 134)

とし、**Poisson(λ) で N≥5 になる確率**をセル充足率とする。

【仮定】カテゴリが 134 個に一様に散ると置いている。実際はラーメン・カフェに偏るので、
**人気カテゴリは実際にはもっと埋まり、長尾はもっと埋まらない。**
つまりここで出す「全カテゴリ平均」は、**両側に散らばった平均**である。

【仮定】半径は §32 の議論で 1km を使ってきたが、**半径は設計変数**なので
1 / 2 / 3 / 5km も並べる。セル内店舗数は面積比（半径の2乗）で伸ばす。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_cell_fill_now.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

DENSITY_1KM = {"urban": 197.54, "suburban": 27.45, "rural": 5.66}
N_CATEGORIES = 134
TARGET = 5
RADII = (1.0, 2.0, 3.0, 5.0)

ROUTES = {
    "写真経由（現行の dish_media）": (0.1317, 1.89),
    "実効天井の下端 19.26%": (0.1926, 1.89),
    "実効天井の上端 25.63%": (0.2563, 1.89),
    "要求どおり 70%（k は現行のまま）": (0.70, 1.89),
    "店名∪サイト本文（dish 行）41.17%": (0.4117, 1.91),
}


def p_at_least(lmbda: float, k: int) -> float:
    """Poisson(λ) で N>=k になる確率。"""
    if lmbda <= 0:
        return 0.0
    acc = 0.0
    term = math.exp(-lmbda)
    for i in range(k):
        acc += term
        term *= lmbda / (i + 1)
    return max(0.0, 1.0 - acc)


def main() -> None:
    print(f"§32 の成功条件: 1エリア×1カテゴリに distinct {TARGET} 店\n", file=sys.stderr)

    out = {"target": TARGET, "n_categories": N_CATEGORIES,
           "density_1km": DENSITY_1KM, "routes": {}, "required_k": {}}

    for label, (cov, k) in ROUTES.items():
        print(f"=== {label}（カバレッジ {cov * 100:.2f}% / 店あたりカテゴリ k={k}）===",
              file=sys.stderr)
        print(f"{'半径':>6}" + "".join(f"{t:>22}" for t in DENSITY_1KM), file=sys.stderr)
        rows = {}
        for r in RADII:
            cells = []
            for tier, d1 in DENSITY_1KM.items():
                n_in_cell = d1 * r * r
                lam = n_in_cell * cov * (k / N_CATEGORIES)
                cells.append((tier, lam, p_at_least(lam, TARGET)))
            rows[f"{r}km"] = {t: {"lambda": l, "p_ge5": p} for t, l, p in cells}
            print(f"{r:>5.0f}km" + "".join(
                f"{f'λ={l:.2f} 充足{p*100:.1f}%':>22}" for _, l, p in cells),
                file=sys.stderr)
        out["routes"][label] = {"coverage": cov, "k": k, "by_radius": rows}
        print("", file=sys.stderr)

    print("=== N>=5 を満たすのに必要な (カバレッジ × k) ===", file=sys.stderr)
    print("  λ>=5 に必要な値。半径ごとに示す。", file=sys.stderr)
    print(f"{'半径':>6}" + "".join(f"{t:>16}" for t in DENSITY_1KM), file=sys.stderr)
    for r in RADII:
        need = {}
        cells = []
        for tier, d1 in DENSITY_1KM.items():
            n_in_cell = d1 * r * r
            req = TARGET * N_CATEGORIES / n_in_cell   # cov × k がこれ以上必要
            need[tier] = req
            cells.append(req)
        out["required_k"][f"{r}km"] = need
        print(f"{r:>5.0f}km" + "".join(f"{c:>16.2f}" for c in cells), file=sys.stderr)

    print("\n  読み方: 例えば半径1km・urban では cov×k >= 3.39 が要る。", file=sys.stderr)
    print("  k=1.89 のままなら cov >= 179% となり**カバレッジをいくら上げても届かない**。",
          file=sys.stderr)
    print("  cov=100% でも k >= 3.39 が要る。", file=sys.stderr)

    print("\n=== 要求 70% を満たしたときに §32 がどうなるか ===", file=sys.stderr)
    cov, k = ROUTES["要求どおり 70%（k は現行のまま）"]
    for r in RADII:
        line = f"  半径{r:.0f}km: "
        for tier, d1 in DENSITY_1KM.items():
            lam = d1 * r * r * cov * (k / N_CATEGORIES)
            line += f"{tier} λ={lam:.2f}(充足{p_at_least(lam, TARGET)*100:.1f}%)  "
        print(line, file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "cell_fill_now.json"
    out_path.write_text(
        json.dumps({**out,
                    "caveat": "カテゴリが134個に一様に散ると仮定している。実際は人気カテゴリに"
                              "偏るので、人気側はもっと埋まり長尾はもっと埋まらない。"
                              "半径は設計変数として 1/2/3/5km を並べた（面積比で伸ばした）。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
