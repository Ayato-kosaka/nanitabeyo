#!/usr/bin/env python3
"""#1273 ここまでの実測を全部入れて、到達できる最大値と不足を出し直す

## なぜ

経路を1本ずつ測り終えたので、**全部足すといくらになるのか**を出す。
これは新しい経路の提案ではなく、**オーナーが方針を決めるための集計**である。
要求 70% を下げる話ではない。

## 使う値（**すべて本PoCの実測。推測は入れない**）

| 経路 | 経路存在率 | 実効への係数 | 出典 |
|---|---|---|---|
| YouTube 長尺チャンネル巡回 | 758ch → 12,013店 | — | ① 実測 |
| YouTube Shorts チャンネル巡回 | 40ch → 236店 | ×0.78 | measure_shorts_effective |
| Shorts エリア検索 | 24エリア → 154店 | ×0.78 | 同上 |
| ブログ | 1人 4.4〜4.8店（150記事）/ 21店（全走査） | 許諾 0/97 | measure_blog_* |
| 長い尾への名前検索 | リンク無し層の 6.7% | — | measure_longtail_posts_exist |

## この集計が言えないこと

  - 経路どうしの重なりは**実測した分だけ**引く（Shorts×長尺の重なり 8店など）。
    未測定の重なりは引いていないので、**合計は上振れ**する
  - 規約の判定は入れていない（ブログは許諾が要る、YouTube は埋め込みのみ 等）
  - **`restaurant_recommendation` データセットは BigQuery に存在しない**ので、
    本番の実在庫とは突き合わせていない

**ネットワークアクセスはしない。**

実行:
    python3 measure_frontier_v2.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

POP = 1_159_183          # 重複除去後の店（measure_denominator_composition）
SEED = 1_132_482         # 恒等式で使っている seed
NOLINK = 358_403         # リンク無し層（= Overture に無い店の 99.92%）
TARGET = 0.70
CURRENT_YIELD = 0.1317   # 600店標本での現行設計の歩留まり（DB充足率ではない）

# 【自戒】最初の版はここに**自社サイト経路を入れ忘れていた**。
# 実効天井 19.26〜25.63% の最大の項はそれなので、入れないと合計が
# 「全経路の合計」ではなく「SNS/ブログ経路の合計」になる。
# 見出しを取り違えると、天井が下がったように読めてしまう。**別枠で明示する。**
OWN_SITE_CEILING = (0.1926, 0.2563)   # measure_env_corrected_ceiling（自社サイト主体）

# SNS / ブログ経路（**自社サイト経路は含まない**）
ROUTES = [
    ("YouTube 長尺チャンネル巡回（758ch 実測）", 12_013, 1.00,
     "#1336。純増は 0.130pt（87.72% がリンク有り層で自社サイト経路と重なる）"),
    ("YouTube Shorts チャンネル巡回（40ch→1,000ch 外挿）", 800, 0.78,
     "倍化 ×1.28 が続く側の外挿。楽観側なら 6,097"),
    ("Shorts エリア検索（24エリア→1,900市区町村 外挿）", 12_160, 0.78,
     "エリア間の重複が0のまま続くと仮定。**明らかに楽観**"),
    ("ブログ（発見できた 2,479人 × 21店）", 52_059, 0.00,
     "許諾が 0/97。**係数0** は「規約上そのまま使える人が居ない」ため"),
    ("長い尾への名前検索（リンク無し 358,403 × 6.7%）", 23_894, 1.00,
     "目視補正後。実効はここからさらに落ちる"),
]


def main() -> None:
    print(f"母集団 {POP:,} / リンク無し層 {NOLINK:,} = {NOLINK/POP*100:.2f}%",
          file=sys.stderr)
    print(f"要求 {TARGET*100:.0f}% = {POP*TARGET:,.0f} 店\n", file=sys.stderr)

    print(f"{'経路':52}{'経路存在率':>12}{'実効係数':>10}{'実効店':>12}{'pt':>8}",
          file=sys.stderr)
    tot_path = tot_eff = 0
    rows = []
    for name, n, coef, note in ROUTES:
        eff = n * coef
        tot_path += n
        tot_eff += eff
        rows.append({"route": name, "path": n, "coef": coef, "eff": eff,
                     "pt": eff / POP * 100, "note": note})
        print(f"{name[:50]:52}{n:>12,}{coef:>10.2f}{eff:>12,.0f}"
              f"{eff/POP*100:>7.2f}%", file=sys.stderr)
    print(f"{'SNS/ブログ経路の合計（重なりを引く前）':52}{tot_path:>12,}{'':>10}"
          f"{tot_eff:>12,.0f}{tot_eff/POP*100:>7.2f}%", file=sys.stderr)
    lo, hi = OWN_SITE_CEILING
    print(f"\n  **別枠: 自社サイト経路（実効天井の最大項） {lo*100:.2f}〜{hi*100:.2f}%**",
          file=sys.stderr)
    print(f"  ただし SNS 経路は 87.72% が自社サイト経路と重なる（#1336）ので、"
          f"\n  **単純に足せない。** 重なりを実測できているのは Shorts×長尺の 8店だけ。",
          file=sys.stderr)

    # 実測できている重なりだけ引く
    overlap = 8          # Shorts × 長尺（measure_k_ceiling の続きで実測）
    print(f"\n  実測できた重なり: Shorts × 長尺 = {overlap} 店だけ。"
          f"**他は未測定なので合計は上振れ**", file=sys.stderr)

    print(f"\n=== 現在地と不足 ===", file=sys.stderr)
    print(f"  現行設計の歩留まり（600店標本） {CURRENT_YIELD*100:.2f}%"
          f"（**本番DBの充足率ではない**）", file=sys.stderr)
    print(f"  SNS/ブログ経路の合計（実効）    {tot_eff/POP*100:.2f}%", file=sys.stderr)
    print(f"  自社サイト経路（別枠・既報）    {OWN_SITE_CEILING[0]*100:.2f}〜"
          f"{OWN_SITE_CEILING[1]*100:.2f}%", file=sys.stderr)
    print(f"  **重なりが大きいので、上2つの単純和は取らない**", file=sys.stderr)
    print(f"  要求                          {TARGET*100:.0f}%", file=sys.stderr)
    gap = POP * TARGET - POP * OWN_SITE_CEILING[1] - tot_eff
    print(f"  **不足（自社サイト上端 {OWN_SITE_CEILING[1]*100:.2f}% と SNS を"
          f"重なり0と仮定して足した場合の最良）**", file=sys.stderr)
    print(f"    {gap:,.0f} 店 = **{gap/POP*100:.2f}pt**"
          f"（重なりを考えるとこれより悪い）", file=sys.stderr)

    # リンク無し層の恒等式で見る
    w_l, w_n = 1 - NOLINK / POP, NOLINK / POP
    reach_n = 23_894 / NOLINK      # 名前検索で届くリンク無し層
    need_l = (TARGET - w_n * reach_n) / w_l
    print(f"\n=== 恒等式で見た必要条件 ===", file=sys.stderr)
    print(f"  {w_l:.4f} × r_L + {w_n:.4f} × r_N = {TARGET}", file=sys.stderr)
    print(f"  リンク無し層に届く実測 r_N = {reach_n*100:.2f}%"
          f"（名前検索。これが現時点の最大）", file=sys.stderr)
    print(f"  → 必要な r_L = **{need_l*100:.2f}%**", file=sys.stderr)
    if need_l > 1:
        print(f"  **r_L は 100% を超えている。この組合せでは 70% に到達できない。**",
              file=sys.stderr)
        max_total = w_l * 1.0 + w_n * reach_n
        print(f"  リンク有り層を 100% 埋めても最大 {max_total*100:.2f}%"
              f"（不足 {(TARGET-max_total)*100:.2f}pt）", file=sys.stderr)
        need_rn = (TARGET - w_l * 1.0) / w_n
        print(f"  70% に届かせるには r_N ≥ **{need_rn*100:.2f}%** が要る"
              f"（実測 {reach_n*100:.2f}% の {need_rn/reach_n:.1f}倍）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "frontier_v2.json"
    p.write_text(json.dumps(
        {"pop": POP, "nolink": NOLINK, "target": TARGET,
         "current_yield_600_sample": CURRENT_YIELD,
         "own_site_ceiling": OWN_SITE_CEILING,
         "routes": rows, "total_path": tot_path, "total_eff": tot_eff,
         "total_pt": tot_eff / POP * 100, "gap_stores": gap,
         "r_n_measured": reach_n, "r_l_required": need_l,
         "caveat": "経路どうしの重なりは実測できた分しか引いていないので合計は上振れ。"
                   "規約の判定は入っていない。"
                   "restaurant_recommendation データセットは BigQuery に存在しないので"
                   "本番の実在庫とは突き合わせていない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
