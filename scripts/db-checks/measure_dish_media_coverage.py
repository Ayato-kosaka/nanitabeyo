#!/usr/bin/env python3
"""#843 のクローズ条件「`area × dish_category` ごとに usable dish_media を持つ異なる
店舗が 5 店舗以上ある」の coverage を測る読み取り専用スクリプト（#1782）。

## 前提（発明していない。#1782 の設計調査 / PL 判断ログから引いている）

- **「area」はプロダクトに存在しない単位である。** 店提案は行政区画を使わず、
  中心点 + 半径（アプリ上限 20km）の円検索（`dish-media.repository.ts:200-209`）。
  ここでは restaurants の座標を `--grid-degree` 度グリッドへスナップした重心を
  代表点として使う。**これは計測の便宜であって、新しい area 単位の定義ではない。**
  数字を比べるときは、この前提（グリッド粒度）が揃っているかを必ず確認すること。
- **「usable dish_media」は店提案側（`findDishMediaIds` / `base_candidates` CTE）の
  5 条件を正とする。** 店舗詳細側（`findDishMediaByRestaurant`）は `playback_status` を
  見ておらず定義が違うが、その食い違いはこのスクリプトの対象外（#1782 とは別に扱う）。
  条件そのものは `dish_media_coverage_sql.py` に 1 箇所だけ定義してあり、
  ここでは書き下さない（写経すると #1782 の元になった 2026-08-29 の事故を繰り返す）。
- **Stage3（投稿を取得できる店舗）は対象外。** PostgreSQL に実体が無く、BigQuery
  （#1263 / #1273 の取り込みパイプライン）側の担当。

## 出すもの

1. Stage1: `restaurants` の総件数
2. Stage2: `restaurant_links.kind` ごとの、リンクを持つ店舗数
3. Stage4: category ごとの usable dish_media を持つ店舗数（地理条件なし）
4. Stage5: `area(grid) × dish_category` の coverage 集計と、`--min-restaurants` 未満の
   不足セル一覧（既定 5 店舗未満）

## この数字が言えないこと

- **「投稿を取得できる店舗が何件あるか」（Stage3）は言えない。** PostgreSQL に実体が
  無く、BigQuery（#1263/#1273）側でしか分からない。このスクリプトの出力だけで
  #843 のクローズ判定は完結しない
- **「日本のどこでも店提案が動く」とは言えない。** グリッドは restaurants が実在する
  座標から作るため、店舗が1件も無い空白地帯はそもそもセルとして現れず、
  「不足セル一覧に無い＝そこも十分」という意味にはならない
- **他の粒度（行政区画・別のグリッド幅）で測った数字とは比較できない。** `--grid-degree`
  を変えると代表点も不足セル数も変わる。前提（`assumptions` フィールド）が同じ実行
  同士でしか比べられない
- **店舗詳細画面（`findDishMediaByRestaurant`）の「使える」件数とは一致しない。**
  そちらは `playback_status` を見ておらず定義が異なる（#1782 で判明。直すのは別件）
- **鮮度は測定した瞬間のもの。** `dish_media` は日々増減するため、この JSON の
  数字は `measured_at` の時点のスナップショットでしかない

標準出力に人が読める表を出したあと、**最後の1行に機械可読な JSON を1行で出す**
（`--out-json` を渡すとファイルにも書く。GitHub Actions の Job Summary は
標準出力をそのまま貼るだけなので、ファイルを書いてもランナー終了後に消える。
JSON を必ず標準出力にも出すのはこのため）。

## 重いクエリを現実的な時間で終わらせる工夫

Stage5 は `area_centers × dish_categories` の CROSS JOIN になり、dev の店舗規模
（#843 記載で約62万件）だと素直に書くと重い。**usable dish_media を一時テーブルへ
materialize してから GiST 索引 / category_id 索引を張り**、そこへ JOIN する
（`dish_media_coverage_sql.build_usable_dish_media_temp_table_sql` 参照）。

不足セル一覧を出すクエリ（HAVING あり）は CROSS JOIN を **1 回だけ**実行する。
「全セル数」「カテゴリ数」は別の軽いクエリで数え、不足セル数と突き合わせて
coverage 率を出す（CROSS JOIN を HAVING 無しでも実行する二重コストを避けるため）。

## 読み取り専用である（ただし全区間ではない）

SELECT・CREATE TEMP TABLE・一時テーブルへの CREATE INDEX しか実行しない。
`restaurants` / `dishes` / `dish_media` などの永続テーブルへは一切書き込まない。

**「一時テーブルは read-only トランザクションでも作成できる」は誤りだった。**
PostgreSQL の read-only トランザクションは `CREATE` / `ALTER` / `DROP` を種類を問わず
一律に禁じており、一時テーブルであっても DDL は通らない（read-only が許すのは、
*既に存在する*一時テーブルへの書き込みまで）。実際に `db-script-run.yml` から
dev へ向けて実行したところ、`CREATE TEMP TABLE` で次の例外で落ちた
（run: https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33674497269）。

    psycopg2.errors.ReadOnlySqlTransaction:
    cannot execute CREATE TABLE AS in a read-only transaction

そのため、接続全体を readonly セッションにするのはやめ、次の順序で
「一時テーブルを作る区間だけ」read-only を外す。

1. 接続時は `autocommit=True` のみ付ける（`readonly=True` は付けない）
2. `usable_dish_media_tmp` の作成・索引作成・`ANALYZE` を終える
3. その直後に `SET default_transaction_read_only = on` を実行し、以降のセッションを
   read-only に切り替える
4. Stage4 / Stage5（一時テーブルの読み取りのみ）はこの read-only セッションで走る

DDL を流す区間は手順2（一時テーブルの作成）だけに限られ、それ以降は
「永続テーブルへ書かない」ことがセッションレベルで保証される。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_dish_media_coverage.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt   # psycopg2-binary を含む既定値のままでよい

グリッド粒度や半径・閾値を変えたいときは引数を足す:

    args: --schema dev --grid-degree 0.2 --radius-m 20000 --min-restaurants 5 --max-shortage-rows 2000

ローカルでの単体テスト（DB 接続なし、SQL の組み立てだけを検査）:

    python3 -m unittest scripts/db-checks/test_dish_media_coverage_sql.py -v
    python3 -m unittest scripts/db-checks/test_measure_dish_media_coverage.py -v  # read-only 切り替えの順序

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須。db-script-run.yml が secrets から渡す）
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone

import psycopg2

import dish_media_coverage_sql as coverage_sql

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def section(title: str) -> None:
    logger.info("")
    logger.info("=" * 72)
    logger.info("# %s", title)
    logger.info("=" * 72)


def run_stage1(cur) -> int:
    section("Stage1: restaurants の総件数")
    cur.execute(coverage_sql.build_stage1_total_restaurants_sql())
    total = cur.fetchone()[0]
    logger.info("total_restaurants = %s", f"{total:,}")
    return total


def run_stage2(cur) -> list[dict]:
    section("Stage2: kind ごとの、外部リンクを持つ店舗数（restaurant_links）")
    cur.execute(coverage_sql.build_stage2_restaurant_links_sql())
    rows = cur.fetchall()
    result = [
        {"kind": kind, "restaurants_with_link": count} for kind, count in rows
    ]
    if not result:
        logger.info("（restaurant_links に行が無い）")
    for row in result:
        logger.info("kind=%-20s restaurants_with_link=%s", row["kind"], f"{row['restaurants_with_link']:,}")
    return result


def build_usable_dish_media_temp_table(cur, table_name: str) -> None:
    # ここだけが DDL を流す区間。read-only トランザクションでは CREATE TABLE AS が
    # ReadOnlySqlTransaction で拒否されるため（実測: run 33674497269）、この関数を
    # 呼ぶ時点ではまだ read-only にしていない。呼び終えたら直後に呼び出し側が
    # `SET default_transaction_read_only = on` へ切り替える。
    cur.execute(coverage_sql.build_usable_dish_media_temp_table_sql(table_name))
    for index_sql in coverage_sql.build_usable_dish_media_temp_index_sql(table_name):
        cur.execute(index_sql)
    cur.execute(f"ANALYZE {table_name}")
    cur.execute(f"SELECT count(*) FROM {table_name}")
    logger.info("usable_dish_media 一時テーブル: %s 行", f"{cur.fetchone()[0]:,}")


def run_stage4(cur, table_name: str) -> list[dict]:
    section("Stage4: category ごとの usable dish_media を持つ店舗数（地理条件なし）")
    cur.execute(coverage_sql.build_stage4_category_coverage_sql(table_name))
    rows = cur.fetchall()
    result = [
        {"category_id": category_id, "restaurants_with_usable_media": count}
        for category_id, count in rows
    ]
    logger.info("category 数（usable dish_media が1件以上ある）= %s", f"{len(result):,}")
    for row in result[:10]:
        logger.info(
            "category_id=%-24s restaurants_with_usable_media=%s",
            row["category_id"],
            f"{row['restaurants_with_usable_media']:,}",
        )
    if len(result) > 10:
        logger.info("… 他 %s 件（全件は JSON 出力を見ること）", f"{len(result) - 10:,}")
    return result


def run_stage5(
    cur,
    table_name: str,
    grid_degree: float,
    radius_m: float,
    min_restaurants: int,
    max_shortage_rows: int,
    statement_timeout_s: int,
) -> dict:
    section("Stage5: area(grid) x dish_category の coverage")

    cur.execute(coverage_sql.build_area_center_count_sql(grid_degree))
    total_area_cells = cur.fetchone()[0]
    cur.execute(coverage_sql.build_dish_category_count_sql())
    total_categories = cur.fetchone()[0]
    total_combos = total_area_cells * total_categories
    logger.info(
        "area セル数(グリッド%s度)=%s / dish_categories 数=%s / 全組み合わせ=%s",
        grid_degree,
        f"{total_area_cells:,}",
        f"{total_categories:,}",
        f"{total_combos:,}",
    )

    cur.execute(f"SET statement_timeout = '{statement_timeout_s}s'")
    try:
        cur.execute(
            coverage_sql.build_shortage_cells_sql(
                grid_degree=grid_degree,
                radius_m=radius_m,
                min_restaurants=min_restaurants,
                table_name=table_name,
            )
        )
        rows = cur.fetchall()
    except psycopg2.errors.QueryCanceled:
        logger.error(
            "❌ Stage5 が %s 秒でタイムアウトしました。--grid-degree を大きく（粗く）するか、"
            "--statement-timeout-s を伸ばして再実行してください。",
            statement_timeout_s,
        )
        raise

    shortage_cells = [
        {
            "grid_lat": float(grid_lat),
            "grid_lng": float(grid_lng),
            "restaurant_count": restaurant_count,
            "category_id": category_id,
            "category_label": category_label,
            "restaurants_with_usable_media": restaurants_with_usable_media,
        }
        for grid_lat, grid_lng, restaurant_count, category_id, category_label, restaurants_with_usable_media in rows
    ]
    shortage_count = len(shortage_cells)
    omitted = max(0, shortage_count - max_shortage_rows)
    if omitted:
        logger.warning(
            "⚠ 不足セルが %s 件あり、JSON には先頭 %s 件だけを載せます（%s 件を省略）。"
            " --max-shortage-rows を上げれば全件出せます。",
            f"{shortage_count:,}",
            f"{max_shortage_rows:,}",
            f"{omitted:,}",
        )
    covered_combos = total_combos - shortage_count
    coverage_rate = (covered_combos / total_combos) if total_combos else None

    logger.info(
        "不足セル（usable dish_media を持つ店舗が %s 店舗未満）= %s / %s（coverage率 %s）",
        min_restaurants,
        f"{shortage_count:,}",
        f"{total_combos:,}",
        f"{coverage_rate:.1%}" if coverage_rate is not None else "n/a",
    )

    return {
        "grid_degree": grid_degree,
        "radius_m": radius_m,
        "min_restaurants": min_restaurants,
        "total_area_cells": total_area_cells,
        "total_categories": total_categories,
        "total_area_category_combos": total_combos,
        "shortage_combos": shortage_count,
        "covered_combos": covered_combos,
        "coverage_rate": coverage_rate,
        "shortage_cells": shortage_cells[:max_shortage_rows],
        "shortage_cells_omitted": omitted,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--schema", default="dev", help="対象スキーマ（既定: dev）")
    parser.add_argument(
        "--grid-degree",
        type=float,
        default=coverage_sql.DEFAULT_GRID_DEGREE,
        help=f"area 代表点のグリッド粒度（度。既定: {coverage_sql.DEFAULT_GRID_DEGREE}）",
    )
    parser.add_argument(
        "--radius-m",
        type=float,
        default=coverage_sql.DEFAULT_RADIUS_M,
        help=f"店提案と同じ半径検索の半径（メートル。既定: {coverage_sql.DEFAULT_RADIUS_M}）",
    )
    parser.add_argument(
        "--min-restaurants",
        type=int,
        default=coverage_sql.DEFAULT_MIN_RESTAURANTS,
        help=f"不足セルと判定する閾値（この店舗数未満。既定: {coverage_sql.DEFAULT_MIN_RESTAURANTS}）",
    )
    parser.add_argument(
        "--max-shortage-rows",
        type=int,
        default=2000,
        help="JSON へ載せる不足セルの最大件数（既定: 2000。超えた分は omitted 件数として明示する）",
    )
    parser.add_argument(
        "--statement-timeout-s",
        type=int,
        default=300,
        help="Stage5 の CROSS JOIN に許す最大秒数（既定: 300）",
    )
    parser.add_argument(
        "--out-json",
        default=None,
        help="結果 JSON の書き出し先（省略時はファイルへ書かない。標準出力へは常に出す）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    measured_at = datetime.now(timezone.utc).isoformat()

    with psycopg2.connect(database_url) as conn:
        # readonly=True は付けない。一時テーブルの CREATE TABLE AS / CREATE INDEX は
        # read-only トランザクションでは実行できない（PostgreSQL の read-only は DDL を
        # 種類を問わず禁じる。実測: run 33674497269）。read-only への切り替えは、
        # 一時テーブルを作り終えた直後に `SET default_transaction_read_only = on` で行う。
        #
        # autocommit にするのは diagnose_slow_db.py と同じ理由: 1文でも失敗すると
        # rollback で search_path / statement_timeout ごと巻き戻る（#1706 で踏んだ罠）。
        conn.set_session(autocommit=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            current_user, current_database = cur.fetchone()
            logger.info(
                "接続先: user=%s db=%s schema=%s / 測定日時(UTC)=%s",
                current_user,
                current_database,
                args.schema,
                measured_at,
            )

            stage1_total_restaurants = run_stage1(cur)
            stage2_restaurant_links = run_stage2(cur)

            table_name = coverage_sql.DEFAULT_TEMP_TABLE_NAME
            section("usable dish_media を一時テーブルへ materialize")
            build_usable_dish_media_temp_table(cur, table_name)

            # 一時テーブルの作成が終わった直後に read-only へ切り替える。
            # 以降（Stage4 / Stage5）は永続テーブルへの書き込みがセッションレベルで拒否される。
            cur.execute("SET default_transaction_read_only = on")
            logger.info("一時テーブル作成後、セッションを read-only に切り替えました")

            stage4_category_coverage = run_stage4(cur, table_name)
            stage5 = run_stage5(
                cur,
                table_name,
                grid_degree=args.grid_degree,
                radius_m=args.radius_m,
                min_restaurants=args.min_restaurants,
                max_shortage_rows=args.max_shortage_rows,
                statement_timeout_s=args.statement_timeout_s,
            )

    result = {
        "measured_at": measured_at,
        "schema": args.schema,
        "assumptions": {
            "area_definition": (
                "restaurants の座標を grid_degree 度グリッドへスナップした重心。"
                "行政区画ではない。店提案は中心点+半径の円検索であり area という単位自体が"
                "プロダクトに存在しないため、計測の便宜として使っている（#1782 判断ログ参照）"
            ),
            "usable_dish_media_definition": (
                "店提案側（dish-media.repository.ts findDishMediaIds / base_candidates CTE）"
                "の5条件。店舗詳細側（playback_status を見ない）とは定義が異なる"
            ),
            "stage3_excluded": "投稿を取得できる店舗数（BigQuery側。#1263/#1273）はこのスクリプトの対象外",
            "grid_degree": args.grid_degree,
            "radius_m": args.radius_m,
            "min_restaurants": args.min_restaurants,
        },
        "stage1_total_restaurants": stage1_total_restaurants,
        "stage2_restaurant_links_by_kind": stage2_restaurant_links,
        "stage4_usable_dish_media_by_category": stage4_category_coverage,
        "stage5_area_x_category_coverage": stage5,
    }

    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info("")
        logger.info("JSON を書き出しました: %s", args.out_json)

    logger.info("")
    logger.info("=" * 72)
    logger.info("# JSON（機械可読。db-script-run.yml の Job Summary から回収する）")
    logger.info("=" * 72)
    print(json.dumps(result, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
