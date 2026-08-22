#!/usr/bin/env python3
"""#1273 反証: 「カメラロール考古学」で +30pt を出すのに必要な寄贈ユーザー数 N を出す。

提案は「1人あたり distinct 店舗数 D と参加者数 N に対する飽和曲線が、この案の全て」と
自分で言っている。ならばそこを先に計算する。実測20〜30台を待つ必要はない。
D を振っても答えが変わらないなら、その実測は不要になる。

モデル（**提案側に最大限有利**に置く）:
  - 母集団 M = 1,159,362（統合母集団 strict）
  - 各ユーザーは distinct な D 店の料理写真を持つ
  - 店の「撮られやすさ」は Zipf(s): p_i ∝ i^{-s}
  - ユーザー間の抽選は**独立**（実際は地理的に強く重なるので、これは N を過小評価する＝有利）
  - EXIF GPS 欠落・突合失敗・カテゴリ確定失敗・寄贈途中離脱は**すべて 0%**（有利）
  - 既存経路が押さえている頭 25% と、この経路が拾う店は**完全に重ならない**とは
    仮定せず、全体カバレッジで測る（Zipf の頭は既存経路と必ず衝突する）

これらの仮定はすべて楽観側なので、出てくる N は **必要人数の下限**である。

出力: out/cameraroll_saturation.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

M = 1_159_362
TARGETS = (0.30, 0.50, 0.70)
S_VALUES = (0.6, 0.8, 1.0, 1.2)
D_VALUES = (20, 50, 100, 300)

# 対数ビンで Zipf を近似（M=116万を1件ずつ回すのを避ける）
NBINS = 4000


def zipf_bins(s: float):
    """(代表ランク, ビン内店舗数, 正規化前重み) を返す。"""
    edges = [1]
    for b in range(NBINS):
        e = int(round(math.exp(math.log(M) * (b + 1) / NBINS)))
        if e > edges[-1]:
            edges.append(e)
    bins = []
    for a, b in zip(edges, edges[1:]):
        cnt = b - a
        rep = (a + b - 1) / 2.0
        bins.append((rep, cnt))
    if edges[-1] < M:
        bins.append(((edges[-1] + M) / 2.0, M - edges[-1]))
    total = sum(cnt * rep ** (-s) for rep, cnt in bins)
    return [(rep, cnt, rep ** (-s) / total) for rep, cnt in bins]


def coverage(bins, K: float) -> float:
    """K = 総 (ユーザー×店) 抽選回数 のときのカバレッジ率。"""
    acc = 0.0
    for _rep, cnt, p in bins:
        acc += cnt * (1.0 - math.exp(-K * p))
    return acc / M


def solve_K(bins, target: float) -> float:
    lo, hi = 1.0, 1e15
    if coverage(bins, hi) < target:
        return float("inf")
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if coverage(bins, mid) < target:
            lo = mid
        else:
            hi = mid
    return hi


def main() -> None:
    result = {"M": M, "assumptions": "独立抽選・欠落0%・離脱0%（すべて提案に有利）", "grid": []}
    print(f"母集団 M = {M:,}  ※すべての損失を0%とした最良ケース\n", file=sys.stderr)

    header = "s     target      必要抽選数K   " + "  ".join(f"N(D={d})" for d in D_VALUES)
    print(header, file=sys.stderr)
    print("-" * len(header), file=sys.stderr)

    for s in S_VALUES:
        bins = zipf_bins(s)
        for t in TARGETS:
            K = solve_K(bins, t)
            row = {"s": s, "target": t, "K": K,
                   "N_by_D": {str(d): (K / d if math.isfinite(K) else None) for d in D_VALUES}}
            result["grid"].append(row)
            cells = "  ".join(
                (f"{K/d:>10,.0f}" if math.isfinite(K) else f"{'inf':>10}") for d in D_VALUES
            )
            print(f"{s:<5} {t*100:>5.0f}%  {K:>14,.0f}   {cells}", file=sys.stderr)
        print(file=sys.stderr)

    # 一様（最も甘い）ケース: クーポンコレクタ
    print("参考: 撮られやすさが完全一様（最も甘い）なら", file=sys.stderr)
    for t in TARGETS:
        K = -M * math.log(1 - t)
        print(f"  {t*100:.0f}%: K={K:,.0f}  N(D=100)={K/100:,.0f}", file=sys.stderr)
        result.setdefault("uniform", []).append({"target": t, "K": K, "N_D100": K / 100})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cameraroll_saturation.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\nwrote out/cameraroll_saturation.json", file=sys.stderr)


if __name__ == "__main__":
    main()
