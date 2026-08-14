#!/usr/bin/env python3
"""#1273 実測した funnel 係数を全部つないで「実効カバレッジ」の天井を出す

## なぜ

これまで報告してきた 55.17% は**経路存在率**（その店に到達する手段があるか）であり、
**dish_media が1件でも作れるか**ではない。両者を混ぜると届かないものを届くように見せる。

本スクリプトは**新しい測定をしない**。既に実測済みの係数だけを、
どれがどの測定由来かを明示しながら合成する。合成の仮定も全部書く。

## 使う係数（全て実測値。出典を併記）

| 係数 | 値 | 出典 |
|---|---|---|
| リンク層の割合 | 69.69% | measure_seed_population.py（全数） |
| own_site 経路存在率 | 45.8% | measure_multisource_ceiling.py（600店、チェーン込み） |
| own_site の dish画像あり | 17.17%(103/600) | own-website-images.json を新ゲート(min200+食語)で再判定 |
| own_site 画像の目視 precision | 独立店 46.7% / チェーン 75.0% | visual_verification / chain_visual_labels.json |
| own_site のカテゴリ付与率 | 76.7% | 上記103店に CategoryMatcher を適用 |
| YouTube 経路存在率 | 33.5% | measure_multisource_ceiling.py（600店） |
| YouTube のカテゴリ付与率 | 75.4% | dish_media_yield_after_fix.json |
| リンク無し層の実効 | 19.93% | measure_linkless_funnel.py（経路38.33% × カテゴリ52.0%） |

## 合成の仮定（ここを読まずに数字だけ使わないこと）

1. **union は独立と仮定**。実測していないので上限側に出る。
2. **YouTube は「店名が出る動画があれば料理も映っている」と仮定**。
   映っているかは未検証なので、これも上限側。
3. own_site の precision は独立店/チェーンの構成比が不明なので**両端で幅を出す**。

つまりここで出る数字は**上限**であり、実際はこれより低い。

実行:
    python3 measure_effective_ceiling.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

SHARE_LINK = 789_235 / 1_132_482
SHARE_LINKLESS = 343_247 / 1_132_482

OWN_SITE_PATH = 0.458
OWN_SITE_DISH_IMAGE = 103 / 600
OWN_SITE_PRECISION_LOW = 0.467   # 独立店サイトの目視 precision
OWN_SITE_PRECISION_HIGH = 0.750  # チェーン本部サイトの目視 precision
OWN_SITE_CATEGORY = 0.767

YT_PATH = 0.335
YT_CATEGORY = 0.754

LINKLESS_EFFECTIVE = 0.1993
LINKLESS_PATH = 0.3833
LINK_PATH = 0.625
OWNER_TARGET = 0.70


def main() -> None:
    rows = []
    for label, precision in (("下限側(独立店 precision)", OWN_SITE_PRECISION_LOW),
                             ("上限側(チェーン precision)", OWN_SITE_PRECISION_HIGH)):
        own_eff = OWN_SITE_DISH_IMAGE * precision * OWN_SITE_CATEGORY
        yt_eff = YT_PATH * YT_CATEGORY
        # #1273 【仮定】独立と仮定した union。実測していないので上限側。
        link_eff = 1 - (1 - own_eff) * (1 - yt_eff)
        total = link_eff * SHARE_LINK + LINKLESS_EFFECTIVE * SHARE_LINKLESS
        rows.append({
            "label": label, "own_site_effective": own_eff, "youtube_effective": yt_eff,
            "link_layer_effective": link_eff, "total_effective": total,
        })
        print(f"=== {label} ===", file=sys.stderr)
        print(f"  own_site 実効 : {OWN_SITE_DISH_IMAGE * 100:.2f}%(dish画像) × "
              f"{precision * 100:.1f}%(precision) × {OWN_SITE_CATEGORY * 100:.1f}%(カテゴリ) "
              f"= {own_eff * 100:.2f}%", file=sys.stderr)
        print(f"  YouTube 実効  : {YT_PATH * 100:.1f}%(経路) × "
              f"{YT_CATEGORY * 100:.1f}%(カテゴリ) = {yt_eff * 100:.2f}%", file=sys.stderr)
        print(f"  リンク層 実効 : {link_eff * 100:.2f}%（経路存在は {LINK_PATH * 100:.1f}%）",
              file=sys.stderr)
        print(f"  リンク無し層  : {LINKLESS_EFFECTIVE * 100:.2f}%"
              f"（経路存在は {LINKLESS_PATH * 100:.2f}%）", file=sys.stderr)
        print(f"  **全体の実効天井: {total * 100:.2f}%**\n", file=sys.stderr)

    path_ceiling = LINK_PATH * SHARE_LINK + LINKLESS_PATH * SHARE_LINKLESS
    lo = min(r["total_effective"] for r in rows)
    hi = max(r["total_effective"] for r in rows)

    print("=== まとめ ===", file=sys.stderr)
    print(f"  経路存在率の天井 : {path_ceiling * 100:.2f}%", file=sys.stderr)
    print(f"  **実効の天井     : {lo * 100:.2f}% 〜 {hi * 100:.2f}%**", file=sys.stderr)
    print(f"  要求 {OWNER_TARGET * 100:.0f}% との差: "
          f"{(OWNER_TARGET - hi) * 100:.2f}pt 〜 {(OWNER_TARGET - lo) * 100:.2f}pt",
          file=sys.stderr)
    print(
        "\n  ※ union を独立と仮定し、YouTube は「店名が出る動画には料理も映っている」と\n"
        "     仮定している。どちらも上限側に効くので、実際はこの範囲より低い。",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "effective_ceiling.json"
    out_path.write_text(
        json.dumps(
            {
                "inputs": {
                    "share_link": SHARE_LINK, "share_linkless": SHARE_LINKLESS,
                    "own_site_path": OWN_SITE_PATH,
                    "own_site_dish_image": OWN_SITE_DISH_IMAGE,
                    "own_site_precision_low": OWN_SITE_PRECISION_LOW,
                    "own_site_precision_high": OWN_SITE_PRECISION_HIGH,
                    "own_site_category": OWN_SITE_CATEGORY,
                    "yt_path": YT_PATH, "yt_category": YT_CATEGORY,
                    "linkless_effective": LINKLESS_EFFECTIVE,
                },
                "scenarios": rows,
                "path_existence_ceiling": path_ceiling,
                "effective_ceiling_low": lo,
                "effective_ceiling_high": hi,
                "owner_target": OWNER_TARGET,
            },
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
