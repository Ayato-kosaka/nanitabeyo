#!/usr/bin/env python3
"""#1947 アプリの «近傍» で KPI を測る物差し。決定的な 313 地点・半径 500m。読み取りのみ。

## なぜこれが要るか

この物差しは 2026-09-09 から報告に使ってきたのに、**script として存在しなかった**
（その場限りの SQL だった）。2026-09-18 に同じ数字を再現しようとして失敗し、
過去の報告（`3.393` / `66.1%`）と突き合わせられなかった。**物差しは正本を 1 つ置く。**

## 7_3 との違い（どちらも要る）

| | 分母 | 何を答えるか |
| --- | --- | --- |
| `7_1` / `7_3` | 市区町村 1,843 × 134 カテゴリ | 行政区画で見た KPI と、その到達上限 |
| **これ** | **313 地点 × 134 カテゴリ** | **ユーザーが実際に立つ場所から半径 500m で何が見えるか** |

アプリの検索半径は **500m**（`app-expo/features/dishCategories/constants.ts:13`）であって
市区町村ではない。市区町村で ≥5 でも、ユーザーの足元 500m に無ければ画面には出ない。

## 313 地点の定義（動かしてはいけない）

`restaurant_catalog` の run `restaurant-2026-08-23` / `country_code='JP'` を
`FARM_FINGERPRINT(google_place_id)` で並べた先頭 313 件。

- **決定的**である（乱数を使わない）。いつ実行しても同じ 313 地点になる
- run_id を**固定する**。ここを «最新» にすると過去の実測と比較できなくなる
  （`test_ledger_run_id_freshness.py` がこの 1 箇所だけ例外として許している理由）
- 地点は «飲食店の場所» なので、人が実際に食事を探す場所の分布に寄っている
  （無作為な緯度経度だと海と山ばかりになる）

## 指標の定義（分母を先に）

- セル = `(313 地点 × 134 カテゴリ)` = 41,942
- あるセルの店数 = その地点から 500m 以内にあり、そのカテゴリで**配信されている**店の異なり数
- **`mean_cats_ge5`** = 1 地点あたり «5 店以上あるカテゴリ» の数（KPI の ≥5 と同じ閾値）
- **`pct_zero`** = «5 店以上あるカテゴリ» が 1 つも無い地点の割合

## 写経しないもの

- **134 カテゴリのゲート** = `common_sns.kpi_gate_category_sql`。ラベルから引かない（#1815）
- 配信の実体 = `sns_dish_media_catalog`。ここで品質ゲートを再実装しない

⚠️ `location` は GEOGRAPHY なので `SELECT DISTINCT` / `GROUP BY` に置けない（#1970 で 3 回踏んだ）。
店の座標は «異なり» を取ったあとに JOIN で付ける。
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from common_sns import (TABLE_DISH_MEDIA_CATALOG, TABLE_RESTAURANT_CATALOG,  # noqa: E402
                        kpi_gate_category_sql)

LOGGER = logging.getLogger("7_4")

# 動かすと過去の実測と比較できない。**引数にしていないのは意図である。**
SAMPLE_N = 313
SAMPLE_CATALOG_RUN_ID = "restaurant-2026-08-23"
RADIUS_M = 500


def build_sql(ds: str, dish_ds: str, *, sample_n: int = SAMPLE_N,
              radius_m: int = RADIUS_M) -> str:
    return f"""
    WITH gate AS ({kpi_gate_category_sql(dish_ds, key_param=None)}),
    pts AS (
      SELECT google_place_id AS pid, location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @sample_catalog_run_id AND country_code = 'JP'
      ORDER BY FARM_FINGERPRINT(google_place_id) LIMIT {int(sample_n)}
    ),
    -- GEOGRAPHY は DISTINCT に置けないので «店の異なり» を取ってから座標を付ける
    store_loc AS (
      SELECT google_place_id, ANY_VALUE(location) AS location
      FROM `{ds}.{TABLE_RESTAURANT_CATALOG}`
      WHERE run_id = @sample_catalog_run_id
      GROUP BY google_place_id
    ),
    delivered AS (
      SELECT DISTINCT c.google_place_id AS pid, c.dish_category_id AS cat
      FROM `{ds}.{TABLE_DISH_MEDIA_CATALOG}` c
      JOIN gate g ON g.item_qid = c.dish_category_id
      WHERE c.run_id = @catalog_run_id
    ),
    cell AS (
      SELECT p.pid AS point, d.cat, COUNT(DISTINCT d.pid) AS stores
      FROM pts p
      JOIN delivered d ON TRUE
      JOIN store_loc s ON s.google_place_id = d.pid
      WHERE ST_DWithin(p.location, s.location, {int(radius_m)})
      GROUP BY point, d.cat
    ),
    per_point AS (
      SELECT p.pid AS point,
             (SELECT COUNT(*) FROM cell c WHERE c.point = p.pid AND c.stores >= 5) AS cats_ge5
      FROM pts p
    )
    SELECT
      (SELECT COUNT(*) FROM pts) AS points,
      (SELECT COUNT(*) FROM gate) AS gate_categories,
      ROUND(AVG(cats_ge5), 3) AS mean_cats_ge5,
      ROUND(100 * COUNTIF(cats_ge5 = 0) / COUNT(*), 1) AS pct_zero,
      -- «あと何店で 5 に届くか» の内訳。ここが施策の費用対効果を決める（#1947）
      (SELECT COUNTIF(stores = 4) FROM cell) AS cells_at_4,
      (SELECT COUNTIF(stores = 3) FROM cell) AS cells_at_3,
      (SELECT COUNTIF(stores BETWEEN 1 AND 2) FROM cell) AS cells_at_1_2,
      (SELECT COUNTIF(stores >= 5) FROM cell) AS cells_ge5,
      (SELECT SUM(GREATEST(0, 5 - stores)) FROM cell WHERE stores < 5) AS slots_to_reach5
    FROM per_point
    """


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=f"アプリの近傍（{SAMPLE_N} 地点 × 半径 {RADIUS_M}m）で KPI を測る。読み取りのみ")
    p.add_argument("--catalog-run-id", required=True,
                   help="測る配信カタログの run_id（sns_dish_media_catalog）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dish-dataset", default="wikidata_food_graph")
    p.add_argument("--print-sql", action="store_true",
                   help="SQL を出すだけ（BigQuery へ接続しない）")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ds = f"{args.project}.{args.dataset}"
    sql = build_sql(ds, f"{args.project}.{args.dish_dataset}")
    if args.print_sql:
        print(sql)
        return
    from google.cloud import bigquery  # noqa: PLC0415  認証があるときだけ読む
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    pipeline = BigQueryPipeline()
    rows = list(pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", args.catalog_run_id),
        bigquery.ScalarQueryParameter("sample_catalog_run_id", "STRING", SAMPLE_CATALOG_RUN_ID),
    ]))
    for row in rows:
        d = dict(row)
        LOGGER.info("近傍 %s 地点 × %s カテゴリ（半径 %sm / catalog=%s）",
                    d["points"], d["gate_categories"], RADIUS_M, args.catalog_run_id)
        LOGGER.info("  5 店以上あるカテゴリ数: 平均 %s / ゼロ被覆の地点 %s%%",
                    d["mean_cats_ge5"], d["pct_zero"])
        LOGGER.info("  セル: 達成 %s / あと1店 %s / あと2店 %s / 1〜2店 %s（5 店までの延べ %s 店）",
                    d["cells_ge5"], d["cells_at_4"], d["cells_at_3"],
                    d["cells_at_1_2"], d["slots_to_reach5"])
        print(d)


if __name__ == "__main__":
    main()
