#!/usr/bin/env python3
"""#1273 «料理カテゴリ × 市区町村» のセル検索クエリ集合を生成する（無料ルート共用の骨）。

出力 `out/cell_queries.tsv` は 4_3_collect_search_posts.py がそのまま食える TSV:
    <query>\t<dish_category_id>\t<lat>\t<lng>
- query は「<料理> <市区町村>」（4_3 が末尾に site:instagram.com を付ける）。
- dish_category_id は空（resolve が単一頭脳でキャプションからカテゴリを確定するため、
  ここでの付与は不要。空でよい）。lat/lng も空（エリア座標は任意）。

同じ «料理×市区町村» リストは Serper（柱3）だけでなく、Common Crawl の
料理×エリア検索や、カバレッジ台帳（47都道府県×132カテゴリのセル充足）にも共用する。

都市は «政令指定都市＋主要県庁所在地» を全国に散らして選ぶ。134カテゴリ × 18都市 = 2,412
クエリで Serper 無料枠（約2,500）にちょうど収まる。都市を増やすときは無料枠に留意する。
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS_PATH = HERE / "out" / "dish_categories_jp.json"
OUT_PATH = HERE / "out" / "cell_queries.tsv"

# 柱3 は «柱1+2 で埋まらない残り» の仕上げ（無料枠は一撃 ~2,500）。2026-08-31 15:40Z の
# 134絞りカバレッジ実測で「都市部は厚い・薄いのは地方県」（長野2/134・高知4・山形5・宮崎/島根7…）
# と判明した。旧セットは政令市＝既に充足の都市を叩き、一撃枠を無駄にする。よって対象を
# **薄い県の県庁所在地**へ切替える（134 × 18都市 = 2,412 ≈ 無料枠）。柱1 wave 反映後に
# 空セルが動いたら pillar1_analyze 系で残セルを見て都市を差し替える。
CITIES: list[str] = [
    "長野市", "高知市", "山形市", "宮崎市", "松江市", "福島市",
    "宇都宮市", "大津市", "奈良市", "青森市", "富山市", "甲府市",
    "前橋市", "津市", "徳島市", "佐賀市", "鳥取市", "秋田市",
]


def main() -> None:
    data = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    labels: list[str] = data["categories_ja"]
    lines: list[str] = []
    for city in CITIES:
        for label in labels:
            # query 列のみ。category_id / lat / lng は空（タブ区切りで空セルを保つ）。
            lines.append(f"{label} {city}\t\t\t")
    OUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(lines)} queries "
          f"({len(labels)} categories × {len(CITIES)} cities) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
