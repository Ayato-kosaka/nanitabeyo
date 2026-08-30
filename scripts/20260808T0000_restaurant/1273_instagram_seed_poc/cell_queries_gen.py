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

# 全国に散らした高密度都市（政令市＋主要県庁所在地）。無料枠に収める初期セット。
# 増やすときはここへ足す（134 × len(CITIES) が Serper 無料枠に収まる範囲で）。
CITIES: list[str] = [
    "札幌市", "仙台市", "さいたま市", "千葉市", "新宿区", "横浜市",
    "名古屋市", "金沢市", "京都市", "大阪市", "神戸市", "岡山市",
    "広島市", "高松市", "福岡市", "熊本市", "那覇市", "新潟市",
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
