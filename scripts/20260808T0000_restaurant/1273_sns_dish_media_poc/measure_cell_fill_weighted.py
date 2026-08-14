#!/usr/bin/env python3
"""#1273 §32 のセル充足を「134カテゴリが一様」ではなく**実測のカテゴリ分布**で計算する

## なぜ

`measure_cell_fill_now.py` は λ = セル内店舗数 × カバレッジ × (k/134) と置いた。
**これは「134カテゴリが一様に散る」という仮定**で、実態と大きく違う。
①のクロール実測（12,557 pair）では **ラーメンだけで 41.8%** を占める。

一様仮定は人気カテゴリを過小に、長尾を過大に見せる。**両方とも実態から外れている。**

## 測るもの

キャッシュ済み 194,315本のタイトルを、修正済みの `NameMatcher`（バグ4件修正版）と
`CategoryMatcher` で再判定し、**(店舗, カテゴリ) 対の実測分布 p_c** を出す。
それを使って

    λ_c = セル内店舗数 × カバレッジ × k × p_c

で**カテゴリごとの**セル充足率 P(N>=5) を出す。合計は一様仮定と同じ
（Σ_c λ_c = セル内店舗数 × カバレッジ × k）なので、**分布の形だけが変わる**。

平均の取り方を3つ並べる:
  - 一様平均      : 全134カテゴリの単純平均（前回と同じ）
  - 需要加重      : `market_salience_jp`（0.42-0.98）を正規化して重みにする
  - 供給加重      : p_c 自身を重みにする（「実際に作れる dish_media」から見た平均）

**ネットワークアクセスは一切しない。**

## この計算が言えないこと

`market_salience_jp` は「その料理が日本でどれだけ一般的か」のスコアであって
**ユーザーの検索需要の実測ではない**。需要加重はあくまで代理指標である。

実行:
    python3 measure_cell_fill_weighted.py
"""

from __future__ import annotations

import collections
import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
STATE = OUT_DIR / "crawl_scaleup_state.json"

DENSITY_1KM = {"urban": 197.54, "suburban": 27.45, "rural": 5.66}
TARGET = 5
RADII = (1.0, 2.0, 3.0, 5.0)
COVERAGE = 0.2563   # 実効天井の上端
K = 1.89


def p_at_least(lmbda: float, k: int) -> float:
    if lmbda <= 0:
        return 0.0
    acc = 0.0
    term = math.exp(-lmbda)
    for i in range(k):
        acc += term
        term *= lmbda / (i + 1)
    return max(0.0, 1.0 - acc)


def main() -> None:
    labels = {}
    salience = {}
    with (FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            labels[r["dish_category_id"]] = r["label_ja"]
            salience[r["dish_category_id"]] = float(r["market_salience_jp"])

    matcher = NameMatcher()
    cm = CategoryMatcher()
    state = json.loads(STATE.read_text(encoding="utf-8"))

    pairs: set[tuple[str, str]] = set()
    for ch in state["channels"].values():
        for v in ch.get("videos") or []:
            title = v.get("title") or ""
            if not title:
                continue
            rests = matcher.match_corroborated(title)
            if not rests:
                continue
            cats = {c["dish_category_id"] for c in cm.match(title)}
            for rk in rests:
                for c in cats:
                    pairs.add((rk, c))

    freq = collections.Counter(c for _, c in pairs)
    total = sum(freq.values())
    print(f"(店舗, カテゴリ) 対 {total:,} / distinct 店舗 "
          f"{len({r for r, _ in pairs}):,}", file=sys.stderr)
    print(f"カテゴリが1件でも付いた種類: {len(freq)} / 134", file=sys.stderr)

    p = {c: freq.get(c, 0) / max(total, 1) for c in labels}
    top = sorted(labels, key=lambda c: -p[c])[:15]
    print(f"\n=== 実測のカテゴリ分布（上位15）===", file=sys.stderr)
    for c in top:
        print(f"  {labels[c]:14} {p[c] * 100:>6.2f}%  ({freq.get(c, 0):,})", file=sys.stderr)
    print(f"  上位1件で {p[top[0]] * 100:.1f}%、上位12件で "
          f"{sum(p[c] for c in top[:12]) * 100:.1f}%", file=sys.stderr)

    sal_sum = sum(salience.values())
    out = {"n_pairs": total, "n_categories_used": len(freq),
           "distribution": {labels[c]: p[c] for c in labels},
           "coverage_used": COVERAGE, "k_used": K, "by_radius": {}}

    print(f"\n=== セル充足（カバレッジ {COVERAGE * 100:.2f}% / k={K}）===", file=sys.stderr)
    for r in RADII:
        print(f"\n  --- 半径 {r:.0f}km ---", file=sys.stderr)
        row = {}
        for tier, d1 in DENSITY_1KM.items():
            n_cell = d1 * r * r
            fills = {}
            for c in labels:
                lam = n_cell * COVERAGE * K * p[c]
                fills[c] = p_at_least(lam, TARGET)
            uni = sum(fills.values()) / len(fills)
            dem = sum(fills[c] * salience[c] for c in labels) / sal_sum
            sup = sum(fills[c] * p[c] for c in labels)
            row[tier] = {"uniform_mean": uni, "demand_weighted": dem,
                         "supply_weighted": sup,
                         "top": {labels[c]: fills[c] for c in top[:6]}}
            print(f"    {tier:10} 一様平均 {uni * 100:>6.2f}%  "
                  f"需要加重 {dem * 100:>6.2f}%  供給加重 {sup * 100:>6.2f}%",
                  file=sys.stderr)
            if tier == "urban":
                print(f"      うち: " + " / ".join(
                    f"{labels[c]} {fills[c]*100:.0f}%" for c in top[:6]), file=sys.stderr)
        out["by_radius"][f"{r}km"] = row

    # 一様仮定との比較（前回の数字）
    print(f"\n=== 前回（134カテゴリ一様）との比較 ===", file=sys.stderr)
    for r in RADII:
        n_cell = DENSITY_1KM["urban"] * r * r
        lam_uni = n_cell * COVERAGE * (K / 134)
        print(f"  半径{r:.0f}km urban: 一様仮定 {p_at_least(lam_uni, TARGET) * 100:>6.2f}%  vs "
              f"実測分布の一様平均 "
              f"{out['by_radius'][f'{r}km']['urban']['uniform_mean'] * 100:>6.2f}%  "
              f"需要加重 {out['by_radius'][f'{r}km']['urban']['demand_weighted'] * 100:>6.2f}%",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "cell_fill_weighted.json"
    out_path.write_text(
        json.dumps({**out,
                    "caveat": "market_salience_jp は「日本でどれだけ一般的か」のスコアで"
                              "あってユーザー検索需要の実測ではない。需要加重は代理指標。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
