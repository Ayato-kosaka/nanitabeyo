#!/usr/bin/env python3
"""#1273 店から SNS へ辿れる**起点が何店あるか**を母集団規模で数える（#1345 の1と2と3）

## なぜ

オーナーの疑問は3つある。

    1. YouTube Shorts: なぜ取れないのか
    2. TikTok: チャンネルをクローリングすれば取れるのか
    3. Instagram: 法人登記6万円を払うとどこまでできるのか

どれも「**その店の アカウント/動画 に辿り着けるか**」が前提になっている。
これまでは検索で当てにいく実効を測ってきたが、**そもそも店→アカウントの対応が
データとして何店分あるのか**を母集団規模で数えていなかった。ここが 0 に近ければ、
クローリングの可否や規約の話に進む前に終わる。

## 測り方

`bigquery-public-data.overture_maps.place` の日本の飲食 15 カテゴリについて、
`socials` と `websites` の**全要素**を文字列一致でプラットフォーム別に数えた。
`COUNT(DISTINCT id)` なので、1店が複数の URL を持っても1店として数える。

## この測定が言えないこと

  - **Overture のみ**。母集団 1,132,482 は3ソースの和である
  - socials に載っていないだけで実際にはアカウントを持つ店がある。
    したがってこれは**データ上の経路存在率の下限**であって、**実効ではない**
  - アカウントに辿り着けても、そこに**その店の料理写真があるか**は別の測定である

実行:
    python3 measure_platform_link_coverage.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
POP_TOTAL = 1_132_482


def main() -> None:
    d = json.loads((OUT_DIR / "platform_link_coverage.json").read_text(encoding="utf-8"))
    n = d["n_food_jp"]
    print("=== 店から辿れる SNS の起点は何店あるか（Overture 日本の飲食）===",
          file=sys.stderr)
    print(f"  飲食 {n:,} 店 / socials あり {d['n_any_social']:,} / "
          f"website あり {d['n_any_website']:,}", file=sys.stderr)
    for p in d["platforms"]:
        print(f"  {p['platform']:10} {p['n_stores']:>7,} 店  "
              f"飲食比 **{p['pct_food']:6.3f}%**  母集団比 {p['pct_population']:6.3f}%",
              file=sys.stderr)

    tt = next(p for p in d["platforms"] if p["platform"] == "tiktok")
    ig = next(p for p in d["platforms"] if p["platform"] == "instagram")
    fb = next(p for p in d["platforms"] if p["platform"] == "facebook")

    print("\n=== オーナーの3問に対する、この測定からの答え ===", file=sys.stderr)
    print(f"  2. TikTok  → 起点は **{tt['n_stores']} 店 / {n:,}（{tt['pct_food']:.4f}%）**。"
          f"\n     クローリングの可否以前に、**辿る起点が無い**。"
          f"\n     既存アプリが TikTok を出せているなら、"
          f"**地図データ以外の経路**（利用者投稿・手作業・店名検索）で得ている。"
          f"\n     どれなのかは**この測定では分からない**（推測しない）。", file=sys.stderr)
    print(f"  3. Instagram → 起点は **{ig['n_stores']:,} 店（{ig['pct_food']:.2f}%、"
          f"母集団比 {ig['pct_population']:.2f}%）**。"
          f"\n     法人登記と PPCA を通しても、アカウントが分かる店はこの範囲。"
          f"**70% とは2桁違う**。", file=sys.stderr)
    print(f"  1. YouTube → 起点は **{next(p for p in d['platforms'] if p['platform']=='youtube')['n_stores']} 店**。"
          f"\n     店→チャンネルの対応はほぼ無いので、Shorts は**検索で当てにいくしかない**。"
          f"\n     その実効は別途 out/shorts_effective.json で測ってある。", file=sys.stderr)
    print(f"\n  Facebook だけが **{fb['n_stores']:,} 店（{fb['pct_food']:.2f}%）** と桁違いに多い。"
          f"\n  天井を動かしうる SNS 経路が Facebook しか無い理由はここにある。", file=sys.stderr)

    print("\n=== 注意 ===", file=sys.stderr)
    for x in d["notes"][3:]:
        print(f"  - {x}", file=sys.stderr)
    print(f"  - {d['caveat']}", file=sys.stderr)


SQL = r"""
-- 実行: BigQuery（billing project = food-scroll）。課金 0.45GB。
WITH jp AS (
  SELECT id,
    ARRAY_TO_STRING(ARRAY(SELECT e.element FROM UNNEST(socials.list) e), ' ')  AS soc,
    ARRAY_TO_STRING(ARRAY(SELECT e.element FROM UNNEST(websites.list) e), ' ') AS web
  FROM `bigquery-public-data.overture_maps.place`
  WHERE ST_INTERSECTSBOX(geometry, 122.0, 24.0, 154.0, 46.0)
    AND addresses.list[SAFE_OFFSET(0)].element.country = 'JP'
    AND basic_category IN ('alcoholic_beverage_venue','bar','brewery','cafe',
      'casual_eatery','coffee_shop','distillery','fast_food_restaurant','food_court',
      'food_truck_stand','lounge','non_alcoholic_beverage_venue','restaurant',
      'smoothie_juice_bar','winery')
)
SELECT
  COUNT(*) AS n_food_jp,
  COUNTIF(soc != '') AS n_any_social,
  COUNTIF(web != '') AS n_any_website,
  COUNTIF(REGEXP_CONTAINS(soc, r'(?i)instagram\.com') OR REGEXP_CONTAINS(web, r'(?i)instagram\.com')) AS n_instagram_any,
  COUNTIF(REGEXP_CONTAINS(soc, r'(?i)tiktok\.com')    OR REGEXP_CONTAINS(web, r'(?i)tiktok\.com'))    AS n_tiktok_any,
  COUNTIF(REGEXP_CONTAINS(soc, r'(?i)youtube\.com|youtu\.be') OR REGEXP_CONTAINS(web, r'(?i)youtube\.com|youtu\.be')) AS n_youtube_any,
  COUNTIF(REGEXP_CONTAINS(soc, r'(?i)facebook\.com|fb\.com|fb\.me') OR REGEXP_CONTAINS(web, r'(?i)facebook\.com')) AS n_facebook_any,
  COUNTIF(REGEXP_CONTAINS(soc, r'(?i)facebook\.com|fb\.com|fb\.me') AND web = '') AS n_facebook_socials_only
FROM jp;
"""


if __name__ == "__main__":
    main()
