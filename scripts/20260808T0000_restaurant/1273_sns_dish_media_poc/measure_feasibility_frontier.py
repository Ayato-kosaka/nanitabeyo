#!/usr/bin/env python3
"""#1273 70% に到達するには、リンク有り層とリンク無し層で**それぞれ何%必要か**

## なぜ

これまで経路を1本ずつ「大きさ」で測ってきた。前ラウンドで**重なり**を測ったところ、
①（YouTube）はリンク有り層に偏っていて純増 0.130pt しか無かった。

ここで一度、**要求 70% が成立するための必要条件そのもの**を恒等式から出す。
これは新しい経路の提案ではなく、**どの経路がどれだけ効けば足りるのか**という
判断材料である。要求を下げる話ではない。

## 恒等式（母集団の実測値のみ）

    0.6969 × r_L + 0.3031 × r_N = 0.70

  - r_L … リンク有り 789,235 店（69.69%）のうち dish_media が作れた割合
  - r_N … リンク無し 343,247 店（30.31%）のうち dish_media が作れた割合

ここから、片方を決めればもう片方の**必要値**が一意に決まる。

## 測ってある値を当てはめる

| 値 | 出典 |
|---|---|
| 実効天井 19.26–25.63%（全体） | measure_env_corrected_ceiling.py |
| ①のリンク無し純増 1,475 店 | measure_youtube_additivity.py |
| 施設テナントのリンク無し 5,837 店（経路存在率） | measure_facility_tenant.py |
| 施設テナントの料理写真率 74.1% | measure_facility_photo.py（目視） |
| Panoramax のリンク無し被覆 0.68%（n=146） | measure_panoramax_coverage.py |

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_feasibility_frontier.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

POP_LINK, POP_NOLINK = 789_235, 343_247
POP = POP_LINK + POP_NOLINK
W_L, W_N = POP_LINK / POP, POP_NOLINK / POP
TARGET = 0.70

# 実測済みのリンク無し層への到達（経路存在率）
NOLINK_ROUTES = {
    "施設テナント（屋号に施設名）": 5_837,
    "YouTube ①（純増分）": 1_475,
    "街路画像 Panoramax（0.68% × 343,247）": round(0.0068 * POP_NOLINK),
}


def main() -> None:
    print(f"母集団 {POP:,} = リンク有り {POP_LINK:,} ({W_L*100:.2f}%) + "
          f"リンク無し {POP_NOLINK:,} ({W_N*100:.2f}%)\n", file=sys.stderr)

    print("=== 恒等式 0.6969·r_L + 0.3031·r_N = 0.70 ===", file=sys.stderr)
    print(f"{'r_N（リンク無し層）':>22}{'必要な r_L':>14}", file=sys.stderr)
    rows = {}
    for r_n in (0.0, 0.05, 0.10, 0.20, 0.3031, 0.50, 0.75, 1.0):
        need_l = (TARGET - W_N * r_n) / W_L
        rows[f"{r_n*100:.2f}%"] = need_l
        flag = "  ← 100% を超える（不可能）" if need_l > 1 else ""
        print(f"{r_n*100:>21.2f}%{need_l*100:>13.2f}%{flag}", file=sys.stderr)

    min_rl = (TARGET - W_N) / W_L
    min_rn = (TARGET - W_L) / W_N
    print(f"\n  **リンク無し層が仮に 100% でも、リンク有り層は {min_rl*100:.2f}% 必要**",
          file=sys.stderr)
    print(f"  **リンク有り層が仮に 100% でも、リンク無し層は {min_rn*100:.2f}% 必要**",
          file=sys.stderr)
    print(f"  → リンク有り 69.69% < 70% なので、**リンク無し層を 0 にしたままでは"
          f"到達できない**", file=sys.stderr)

    print(f"\n=== いま測れているリンク無し層への到達（経路存在率）===", file=sys.stderr)
    tot = 0
    for k, v in NOLINK_ROUTES.items():
        tot += v
        print(f"  {k:38} {v:>7,} = {v/POP_NOLINK*100:>5.2f}%", file=sys.stderr)
    print(f"  {'重ならないと仮定した合計（上限）':38} {tot:>7,} = "
          f"{tot/POP_NOLINK*100:>5.2f}%", file=sys.stderr)

    need_l_at_measured = (TARGET - W_N * (tot / POP_NOLINK)) / W_L
    print(f"\n  この r_N = {tot/POP_NOLINK*100:.2f}% のとき、"
          f"必要な r_L は **{need_l_at_measured*100:.2f}%**", file=sys.stderr)

    print(f"\n=== いまの実効天井を当てはめる ===", file=sys.stderr)
    for label, ceil in (("下端 19.26%", 0.1926), ("上端 25.63%", 0.2563)):
        print(f"  全体 {label} のとき、恒等式を満たす組は無数にあるが、"
              f"合計は {ceil*100:.2f}pt しかない", file=sys.stderr)
    gap_lo, gap_hi = TARGET - 0.2563, TARGET - 0.1926
    print(f"  **不足は {gap_lo*100:.2f}〜{gap_hi*100:.2f}pt "
          f"= 店数にして {gap_lo*POP:,.0f}〜{gap_hi*POP:,.0f} 店**", file=sys.stderr)

    print(f"\n=== 読み方 ===", file=sys.stderr)
    print(f"  ・リンク有り層を**全部**埋めても 69.69% で、70% には 0.31pt 足りない。",
          file=sys.stderr)
    print(f"  ・いま測れているリンク無し層への到達は合計 {tot/POP_NOLINK*100:.2f}% "
          f"（重ならないと仮定した上限）。", file=sys.stderr)
    # 【自戒】ここに「2.4〜3.2倍」と**手で書いた数字**を置いていた。計算すると 3.87〜5.15倍で、
    # 桁は合っていたが値が違った。**出力する数字は必ず計算した値にする。**
    r_hi = need_l_at_measured / 0.2563
    r_lo = need_l_at_measured / 0.1926
    print(f"  ・そのとき必要な r_L は {need_l_at_measured*100:.2f}% で、"
          f"実効天井 25.63% の {r_hi:.2f}倍 / 19.26% の {r_lo:.2f}倍 にあたる。",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "feasibility_frontier.json"
    p.write_text(json.dumps(
        {"pop": POP, "w_link": W_L, "w_nolink": W_N, "target": TARGET,
         "required_rl_by_rn": rows,
         "min_rl_if_rn_100": min_rl, "min_rn_if_rl_100": min_rn,
         "nolink_routes": NOLINK_ROUTES,
         "nolink_reach_total": tot,
         "nolink_reach_pct": tot / POP_NOLINK * 100,
         "required_rl_at_measured_rn": need_l_at_measured,
         "gap_pt": [gap_lo * 100, gap_hi * 100],
         "required_rl_vs_ceiling": {"vs_25_63": need_l_at_measured / 0.2563,
                                    "vs_19_26": need_l_at_measured / 0.1926},
         "caveat": "リンク無し層への到達は**経路存在率**であって実効ではない。"
                   "重ならないと仮定して足しているので上限である。"
                   "これは要求を下げる提案ではなく、必要条件を恒等式から出したもの。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
