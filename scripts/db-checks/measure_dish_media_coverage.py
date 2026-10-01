#!/usr/bin/env python3
"""#843 のクローズ条件「`area × dish_category` ごとに usable dish_media を持つ異なる
店舗が 5 店舗以上ある」の coverage を測る読み取り専用スクリプト（#1782）。

## 前提（発明していない。既存の定義に合わせている）

**当初 area をグリッド近似・category を dish_categories 全件（当時 134 件だと誤認）と
していたのは誤りだった。** dev 実測（PR #1799 コメント参照）で `dish_categories` は
14,597 件あり、「134」は JP gate を通過したカテゴリの件数だと判明した。
`scripts/20260808T0000_restaurant/README.md:176` に既存の定義があり、それに合わせて直した。

- **「area」は S2 level 14 セル（既定値。`dish_media_coverage_sql.DEFAULT_S2_LEVEL`）。**
  グリッド近似ではない。
  BigQuery 側は `3_4_build_restaurant_catalog.py` が `S2_CELLIDFROMPOINT(location, @s2_level)`
  （既定 `--service-cell-level 14`）で `service_cell_id` を作っている。PostgreSQL には
  同等の関数が無いため、`restaurants` の座標を1件ずつ読み出し、Python側
  （`scripts/20260808T0000_restaurant/normalization.py` の `s2_cell_id()`。BigQuery
  `S2_CELLIDFROMPOINT` と同じ符号付きINT64）でセル化し、セルごとの重心を代表点として
  一時テーブルへ積む。店提案自体は中心点+半径の円検索であり area という単位自体は
  プロダクトに存在しないが、その代表点の作り方は BigQuery 側と揃えている。
- **「dish_category」は JP gate を通過したカテゴリだけ。** `dish_categories` 全件
  （14,597 件）ではない。`8_1_validate_catalogs.py` の `target_categories` CTE と同じ
  条件（`feature_type='gate' AND feature_key='region:country:JP' AND score > 0`）で、
  PostgreSQL に同期済みの `dish_category_features` を絞る
  （`infra/supabase/migrations/20251224T0003_create_dish_category_features.sql`）。
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
3. Stage4: category（JP gate 通過分）ごとの usable dish_media を持つ店舗数（地理条件なし）
4. Stage5: `area(S2セル) × dish_category(JP gate)` の coverage 集計。全組み合わせのうち
   `--min-restaurants` 以上／未満／ゼロの件数（既定閾値 5 店舗）と、coverage が多い順の
   上位 20 件。不足セルを 1 行ずつは列挙しない（後述「Stage5 のアルゴリズム」参照）

## 既存の coverage 計測（8_1_validate_catalogs.py）との違い

`8_1_validate_catalogs.py` の `coverage_cross_product_complete` / `all_area_category_pairs_filled`
チェックが、**同じ `area(S2セル) × JP gate category` の直積**で coverage をすでに測っている。
ただし見ている実体が違う。

| | 8_1_validate_catalogs.py | このスクリプト |
| --- | --- | --- |
| 見る実体 | BigQuery の `dish_media_coverage_catalog`（パイプライン実行時点のスナップショット） | PostgreSQL の実データ（実行した瞬間の最新状態） |
| area の分母 | `restaurant_service_cell_catalog`（**公開可能と判定された**restaurantだけ） | `restaurants` 全件（公開可否を問わない） |
| 「usable」の意味 | catalog 化パイプラインが `dish_media_catalog` として書き出した投稿 | 店提案の実クエリ（5条件）を今のPostgreSQLへ直接当てた結果 |

**「catalog に載っている」と「本番の店提案で実際に返せる」は別であり、その差こそが
#1782 の存在意義である。** catalog は同期のたびに更新されるスナップショットなので、
同期後に実テーブル側で投稿が削除・非表示化されても catalog 側の数字はすぐには変わらない。
両者は統合しない（統合すると「catalogは正しいが本番はズレている」を検知できなくなる）。

## この数字が言えないこと

- **「投稿を取得できる店舗が何件あるか」（Stage3）は言えない。** PostgreSQL に実体が
  無く、BigQuery（#1263/#1273）側でしか分からない。このスクリプトの出力だけで
  #843 のクローズ判定は完結しない
- **「日本のどこでも店提案が動く」とは言えない。** S2セルは restaurants が実在する
  座標から作るため、店舗が1件も無い空白地帯はそもそもセルとして現れず、
  `covered_zero_restaurants`（coverageゼロの件数）にも含まれない
- ⚠️ **既定の半径（20,000m）と閾値（5 店舗）で測った数字は、«ユーザーの検索が通る率» では
  ない。** アプリの既定の検索半径は **500m**（`DEFAULT_SEARCH_RADIUS`）で、既定値は
  その **40 倍**である。さらに Google fallback が起きるのは `dish-media/search` が
  **0 件**のときだけ（`app-expo/lib/dishMediaSearch.ts`）なので、閾値 5 は fallback の
  境目でもない。#843 の «Google Text Search fallback を不要にする» を測るなら
  `--radius-m 500 --min-restaurants 1` で回し、既定値の系列（2.34% → 13.3% → 29.1%）とは
  **別の量として扱うこと**（混ぜると «塗れた面積» と «検索が通る率» を取り違える）
- **異なる `--s2-level` で測った数字とは比較できない。** レベルを変えるとセルの粒度も
  coverage の件数も変わる。前提（`assumptions` フィールド）が同じ実行同士でしか比べられない
- **店舗詳細画面（`findDishMediaByRestaurant`）の「使える」件数とは一致しない。**
  そちらは `playback_status` を見ておらず定義が異なる（#1782 で判明。直すのは別件）
- **鮮度は測定した瞬間のもの。** `dish_media` は日々増減するため、この JSON の
  数字は `measured_at` の時点のスナップショットでしかない

標準出力に人が読める表を出したあと、**最後の1行に機械可読な JSON を1行で出す**
（`--out-json` を渡すとファイルにも書く。GitHub Actions の Job Summary は
標準出力をそのまま貼るだけなので、ファイルを書いてもランナー終了後に消える。
JSON を必ず標準出力にも出すのはこのため）。

## Stage5 のアルゴリズム（起点を少ない側にする）

当初は `area_cells CROSS JOIN jp_gate_categories`（dev実測で area セル 125,834 ×
カテゴリ 134 = 16,861,756 行）を先に作り、各行へ `ST_DWithin` で usable dish_media を
LEFT JOIN していた。分母（組み合わせ数）は巨大だが、**中身が入り得るのは usable
dish_media が近くにある組み合わせだけ**であり、usable dish_media は dev実測で
4,906 行しかない。この向きのまま statement_timeout=300s で実行すると
`psycopg2.errors.QueryCanceled` でタイムアウトした
（run: https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33698994719）。

そこで JOIN の起点を逆にした（`dish_media_coverage_sql._stage5_matched_sql`）。

1. `usable_dish_media_tmp`（起点。高々数千行）から `jp_gate_categories` を
   `category_id` で INNER JOIN する
2. 各行について、半径 `--radius-m`（既定 20,000m）以内にある `area_cells_tmp` の
   代表点を `ST_DWithin` で INNER JOIN する。`area_cells_tmp` 側に代表点の
   GiST 式索引を張ってあるため（`build_area_cells_temp_index_sql`）、
   全 area_cells を毎回スキャンしない
3. `(s2_cell_id, category_id)` で `GROUP BY` し `COUNT(*)` を取る
   （起点が «(店, カテゴリ) 重複なし» なので DISTINCT は要らない）

INNER JOIN なので、この集計には **coverage が非ゼロの組み合わせしか現れない**。
⚠️ **この重い集計はバッチあたり 1 回だけ評価する**（`build_stage5_matched_rows_sql`）。
件数バケット・上位セル・惜しいセル・カテゴリ別は、その行から `Stage5Accumulator` が作る
（以前は 4 本のクエリに分けており、**同じ集計を 4 回評価**していた。run 36820246635 は
65 分でも終わらなかった）。「0 店舗」の件数は「全組み合わせ数（area セル数 × カテゴリ数、
別の軽いクエリで数える）− この集計の行数」の引き算で出す（`covered_zero`）。
**16.8M 件を 1 行ずつ返す・列挙することはしない。**

## 読み取り専用である（ただし全区間ではない）

SELECT・CREATE TEMP TABLE・一時テーブルへの CREATE INDEX / INSERT しか実行しない。
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
3. `restaurants` の座標を読み出して S2 セル化し、`area_cells_tmp` の作成・INSERT・
   代表点への GiST 式索引作成（`build_area_cells_temp_index_sql`。Stage5 が
   usable dish_media 側からこの索引へ半径検索を投げる）・`ANALYZE` を終える
4. その直後に `SET default_transaction_read_only = on` を実行し、以降のセッションを
   read-only に切り替える
5. Stage4 / Stage5（一時テーブルの読み取りのみ）はこの read-only セッションで走る

DDL を流す区間は手順2・3（一時テーブルの作成）だけに限られ、それ以降は
「永続テーブルへ書かない」ことがセッションレベルで保証される。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_dish_media_coverage.py
    args: --schema dev
    requirements_path: scripts/20260808T0000_restaurant/requirements.txt   # S2セル化に使う s2sphere と psycopg2-binary の両方を含む

`scripts/20251213T0000_wikidata_food_graph/requirements.txt`（このworkflowの既定値）には
`s2sphere` が無く、area の S2 セル化ができないため、**このスクリプトを実行するときは
上記の `requirements_path` を明示的に指定すること。**

S2 level や半径・閾値を変えたいときは引数を足す:

    # 既定値の系列（#843 の完了条件の文言どおり: 半径 20km / 5 店舗以上）
    args: --schema dev --s2-level 14 --radius-m 20000 --min-restaurants 5

    # «ユーザーの検索が自社 DB で通るか»（= Google fallback を避けられるか）
    args: --schema dev --s2-level 14 --radius-m 500 --min-restaurants 1

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
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

import dish_media_coverage_sql as coverage_sql

# S2セル化は scripts/20260808T0000_restaurant/normalization.py の s2_cell_id() を使う
# （新しい定義を作らない。BigQuery S2_CELLIDFROMPOINT と同じ符号付きINT64表現）。
# このディレクトリは通常の import パスに無いため、実行時に sys.path へ足す。
_RESTAURANT_PIPELINE_DIR = (
    Path(__file__).resolve().parents[1] / "20260808T0000_restaurant"
)
if str(_RESTAURANT_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(_RESTAURANT_PIPELINE_DIR))

from normalization import s2_cell_id  # noqa: E402  (sys.path 設定の直後で読む必要がある)

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


def compute_area_cells(
    locations: list[tuple[float, float]], s2_level: int
) -> list[tuple[int, float, float, int]]:
    """restaurants の座標を S2 セル（level=s2_level）へ丸め、セルごとの重心を計算する。

    BigQuery 側（3_4_build_restaurant_catalog.py の `S2_CELLIDFROMPOINT` +
    `ST_CENTROID_AGG`）と同じセル化を、PostgreSQL に相当関数が無いため Python 側で行う。
    戻り値は (s2_cell_id, center_lat, center_lng, restaurant_count) のリスト。
    """
    cells: dict[int, list[float]] = {}
    for latitude, longitude in locations:
        cell_id = s2_cell_id(float(latitude), float(longitude), s2_level)
        agg = cells.setdefault(cell_id, [0.0, 0.0, 0])
        agg[0] += float(latitude)
        agg[1] += float(longitude)
        agg[2] += 1
    return [
        (cell_id, lat_sum / count, lng_sum / count, count)
        for cell_id, (lat_sum, lng_sum, count) in cells.items()
    ]


def build_area_cells_temp_table(cur, table_name: str, s2_level: int) -> int:
    # usable_dish_media_tmp と同様、ここも DDL/DML を流す区間（read-only へ切り替える前）。
    cur.execute(coverage_sql.build_restaurant_locations_sql())
    locations = cur.fetchall()
    area_cells = compute_area_cells(locations, s2_level)

    cur.execute(coverage_sql.build_area_cells_temp_table_sql(table_name))
    if area_cells:
        execute_values(cur, coverage_sql.build_area_cells_insert_sql(table_name), area_cells)
    for index_sql in coverage_sql.build_area_cells_temp_index_sql(table_name):
        cur.execute(index_sql)
    cur.execute(f"ANALYZE {table_name}")
    logger.info(
        "area_cells 一時テーブル（S2 level %s）: %s セル（restaurants %s 件から集計）",
        s2_level,
        f"{len(area_cells):,}",
        f"{len(locations):,}",
    )
    return len(area_cells)


def build_stage5_driver_temp_table(cur, driver_table_name: str, media_table_name: str) -> int:
    """Stage5 の起点を «(店, カテゴリ) 1 行» へ畳む（DDL なので read-only 切り替えより前）。

    ⚠️ 畳んでも数字が変わらない理由は
    `dish_media_coverage_sql.build_stage5_driver_temp_table_sql()` の docstring にある。
    """
    cur.execute(coverage_sql.build_stage5_driver_temp_table_sql(driver_table_name, media_table_name))
    for index_sql in coverage_sql.build_stage5_driver_temp_index_sql(driver_table_name):
        cur.execute(index_sql)
    cur.execute(f"ANALYZE {driver_table_name}")
    cur.execute(coverage_sql.build_stage5_driver_count_sql(driver_table_name))
    rows = cur.fetchone()[0]
    logger.info(
        "Stage5 の起点（JP gate の (店, カテゴリ) 重複なし）: %s 行",
        f"{rows:,}",
    )
    return rows


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


def apply_temp_file_limit(cur, limit_mb: int) -> bool:
    """このセッションが書ける一時ファイルの上限を張る（張れたら True）。

    ## なぜ要るか（#1782 2026-10-01）

    Stage5 が `DiskFull: could not write to file "base/pgsql_tmp/..."` で落ちた
    ([run 36816039711](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36816039711))。
    起点を畳んで溢れないようにしたが、⚠️ **溢れる量は供給側（#1273 / #1263 の取り込み）が
    増えれば また増える**。dev と public は同じ Postgres インスタンスなので
    ([#2006](https://github.com/Ayato-kosaka/nanitabeyo/issues/2006))、
    «共有ディスクを埋める» ではなく **«自分のクエリだけが落ちる»** に倒しておく。

    ## ⚠️ 【バグ】試して失敗するのではなく、**先に聞く**

    `temp_file_limit` は PGC_SUSET（superuser だけが変えられる）で、Supabase の
    `postgres` ロールは superuser ではない。最初の実装は «SET して、失敗したら警告して
    続行» にしていたが、**失敗した SET がトランザクションを abort させ、次の文が
    `InFailedSqlTransaction: current transaction is aborted` で死んだ**
    ([run 36819189609](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36819189609)。
    起点の畳み込みは効いて 904,118 → 148,892 行になっていたのに、**その先で止めたのは
    この «保険» 自身**だった）。

    だから **`is_superuser` を先に見て、張れないなら SET を投げない**。
    投げなければ abort も起きない。⚠️ それでも別の理由で失敗しうるので、
    except では **ROLLBACK で後続が使える状態へ戻す**（«保険» が本体を殺さないように）。

    ⚠️ **黙って続行しない。** 張れなかったことはログへ出す
    （«上限があるつもりで走っていた» を作らない）。
    """
    if limit_mb <= 0:
        logger.info("一時ファイルの上限: 指定なし（--temp-file-limit-mb 0）")
        return False

    if not is_superuser(cur):
        logger.warning(
            "⚠️ 一時ファイルの上限（%s MB）は張れません。"
            "temp_file_limit は superuser だけが変えられ、この接続は superuser ではない。"
            "このまま走るので、溢れると共有ディスクの側で落ちる（#1782）",
            f"{limit_mb:,}",
        )
        return False

    try:
        cur.execute(f"SET temp_file_limit = '{limit_mb}MB'")
    except psycopg2.Error as error:
        # ⚠️ ここへ来たら «abort されたトランザクション» を畳んでおく。
        #    畳まないと、この保険のせいで本体（Stage5）が 1 文も走らない
        try:
            cur.execute("ROLLBACK")
        except psycopg2.Error:
            pass
        logger.warning(
            "⚠️ 一時ファイルの上限を張れませんでした（%s MB）。このまま走る: %s",
            f"{limit_mb:,}",
            str(error).strip().splitlines()[0] if str(error).strip() else error.__class__.__name__,
        )
        return False

    logger.info("一時ファイルの上限: %s MB（超えたらこのクエリだけが落ちる）", f"{limit_mb:,}")
    return True


def is_superuser(cur) -> bool:
    """この接続が superuser か（読み取りだけ。読めなければ False に倒す）。

    ⚠️ **«分からない» を «superuser» 側へ倒してはいけない。** 倒すと SET を投げて
    また abort する（#1782 の run 36819189609 がそれ）。
    """
    try:
        cur.execute("SELECT current_setting('is_superuser', true)")
        value = cur.fetchone()[0]
    except psycopg2.Error:
        return False
    return str(value).lower() == "on"


def stage5_cell_batches(cur, area_table_name: str, cell_batch_size: int) -> list[dict] | None:
    """Stage5 を分割するためのバインドパラメータ列（分割しないなら None）。

    ⚠️ **セルで割る理由と «割っても数字が変わらない» 理由は
    `dish_media_coverage_sql.build_area_cell_ids_sql()` の docstring にある。**
    """
    if cell_batch_size <= 0:
        return None
    cur.execute(coverage_sql.build_area_cell_ids_sql(area_table_name))
    cell_ids = [row[0] for row in cur.fetchall()]
    return [
        {"cell_ids": cell_ids[start : start + cell_batch_size]}
        for start in range(0, len(cell_ids), cell_batch_size)
    ]


def run_stage5(
    cur,
    driver_table_name: str,
    area_table_name: str,
    s2_level: int,
    radius_m: float,
    min_restaurants: int,
    statement_timeout_s: int,
    temp_file_limit_mb: int,
    cell_batch_size: int,
) -> dict:
    section("Stage5: area(S2セル) x dish_category(JP gate) の coverage")

    # ⚠️ statement_timeout より前に張る（時間で殺される前にディスクで殺せるようにする）
    apply_temp_file_limit(cur, temp_file_limit_mb)

    cur.execute(coverage_sql.build_area_cell_count_sql(area_table_name))
    total_area_cells = cur.fetchone()[0]
    cur.execute(coverage_sql.build_jp_gate_category_count_sql())
    total_categories = cur.fetchone()[0]
    total_combos = total_area_cells * total_categories
    logger.info(
        "area セル数(S2 level %s)=%s / JP gate カテゴリ数=%s / 全組み合わせ=%s",
        s2_level,
        f"{total_area_cells:,}",
        f"{total_categories:,}",
        f"{total_combos:,}",
    )

    cur.execute(f"SET statement_timeout = '{statement_timeout_s}s'")

    batches = stage5_cell_batches(cur, area_table_name, cell_batch_size)
    if batches is None:
        logger.info("Stage5 の分割: なし（--cell-batch-size 0）")
    else:
        logger.info(
            "Stage5 の分割: %s セルずつ %s 回（一度に作る中間結果を小さく保つ。#1782）",
            f"{cell_batch_size:,}",
            f"{len(batches):,}",
        )

    # 引き当て表は 1 回だけ取る（1 行ごとに文字列や店舗数を運ばない。#1782）
    cur.execute(coverage_sql.jp_gate_category_select_sql())
    category_labels = {category_id: label for category_id, label in cur.fetchall()}
    cur.execute(coverage_sql.build_area_cell_restaurant_counts_sql(area_table_name))
    cell_restaurant_counts = {cell_id: count for cell_id, count in cur.fetchall()}

    accumulator = coverage_sql.Stage5Accumulator(
        min_restaurants=min_restaurants,
        top_n=coverage_sql.DEFAULT_TOP_CELLS_LIMIT,
    )

    try:
        for index, params in enumerate(batches if batches is not None else [None], start=1):
            # ⚠️ **重い集計はバッチあたり 1 回だけ。** 4 本に分けていた頃は同じ集計を
            #    4 回評価しており、dev では 65 分でも終わらなかった（run 36820246635）
            cur.execute(
                coverage_sql.build_stage5_matched_rows_sql(
                    radius_m=radius_m,
                    area_table_name=area_table_name,
                    driver_table_name=driver_table_name,
                    batched=params is not None,
                ),
                params,
            )
            accumulator.add_rows(cur.fetchall())

            if batches is not None and (index % 10 == 0 or index == len(batches)):
                # ⚠️ 進捗は «数字が動いていること» を外から確かめるために出す。
                #    出さないと «生きているのか» が分からず、待つしかなくなる
                logger.info(
                    "  Stage5 進捗: %s / %s バッチ（coverage 成立 %s 件）",
                    f"{index:,}",
                    f"{len(batches):,}",
                    f"{accumulator.covered_at_or_above_min:,}",
                )
    except psycopg2.errors.QueryCanceled:
        logger.error(
            "❌ Stage5 が %s 秒でタイムアウトしました。--cell-batch-size を小さくするか、"
            "--statement-timeout-s を伸ばして再実行してください。"
            "（起点の行数は上の «Stage5 の起点» のログに出ている。"
            "そこが大きいなら時間ではなく起点の問題である）",
            statement_timeout_s,
        )
        raise

    covered_at_or_above_min = accumulator.covered_at_or_above_min
    covered_below_min = accumulator.covered_below_min
    covered_total = accumulator.covered_total

    def decorate(rows: list[tuple]) -> list[tuple]:
        """(セル, カテゴリ, 店舗数) へ、引き当て表から店舗数とラベルを付け直す。"""
        return [
            (
                s2_cell_id,
                cell_restaurant_counts.get(s2_cell_id),
                category_id,
                category_labels.get(category_id),
                count,
            )
            for s2_cell_id, category_id, count in rows
        ]

    top_rows = decorate(accumulator.top_cells())
    shortfall_rows = decorate(accumulator.shortfall_cells())
    shortfall_category_rows = [
        (category_id, category_labels.get(category_id), shortfall, covered, best)
        for category_id, shortfall, covered, best in accumulator.shortfall_by_category()
    ]

    covered_zero = total_combos - covered_total
    coverage_rate = (covered_at_or_above_min / total_combos) if total_combos else None

    top_cells = [
        {
            "s2_cell_id": s2_cell_id_value,
            "restaurant_count": restaurant_count,
            "category_id": category_id,
            "category_label": category_label,
            "restaurants_with_usable_media": restaurants_with_usable_media,
        }
        for s2_cell_id_value, restaurant_count, category_id, category_label, restaurants_with_usable_media in top_rows
    ]

    shortfall_cells = [
        {
            "s2_cell_id": s2_cell_id_value,
            "restaurant_count": restaurant_count,
            "category_id": category_id,
            "category_label": category_label,
            "restaurants_with_usable_media": restaurants_with_usable_media,
        }
        for s2_cell_id_value, restaurant_count, category_id, category_label, restaurants_with_usable_media in shortfall_rows
    ]
    shortfall_by_category = [
        {
            "category_id": category_id,
            "category_label": category_label,
            "shortfall_cells": shortfall,
            "covered_cells": covered,
            "best_cell_restaurants": best,
        }
        for category_id, category_label, shortfall, covered, best in shortfall_category_rows
    ]

    logger.info(
        "coverage が %s 店舗以上 = %s / %s（%s） / 1〜%s 店舗 = %s / 0 店舗 = %s",
        min_restaurants,
        f"{covered_at_or_above_min:,}",
        f"{total_combos:,}",
        f"{coverage_rate:.1%}" if coverage_rate is not None else "n/a",
        min_restaurants - 1,
        f"{covered_below_min:,}",
        f"{covered_zero:,}",
    )
    for row in top_cells:
        logger.info(
            "s2_cell_id=%s category_id=%-24s restaurants_with_usable_media=%s",
            row["s2_cell_id"],
            row["category_id"],
            f"{row['restaurants_with_usable_media']:,}",
        )

    if shortfall_by_category:
        logger.info("")
        logger.info(
            "-- あと少しで成立するカテゴリ（惜しいセルを多く抱えている順）"
            "。0 店舗のセルは «店を見つけるところから» なので別枠（#1273） --"
        )
        for row in shortfall_by_category:
            logger.info(
                "category_id=%-24s 惜しいセル=%s / 成立済み=%s / 最良セル=%s 店",
                row["category_id"],
                f"{row['shortfall_cells']:,}",
                f"{row['covered_cells']:,}",
                f"{row['best_cell_restaurants']:,}",
            )

    return {
        "s2_level": s2_level,
        "radius_m": radius_m,
        "min_restaurants": min_restaurants,
        "total_area_cells": total_area_cells,
        "total_categories": total_categories,
        "total_area_category_combos": total_combos,
        "covered_at_or_above_min_restaurants": covered_at_or_above_min,
        "coverage_rate": coverage_rate,
        "covered_below_min_restaurants": covered_below_min,
        "covered_zero_restaurants": covered_zero,
        "top_cells": top_cells,
        # #1782 完了条件2。合計値だけでは打ち手が決まらないので、惜しいセルを一覧で残す
        "shortfall_cells": shortfall_cells,
        "shortfall_by_category": shortfall_by_category,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    """引数定義を組み立てる（`parse_args` から分けてテストが help を読めるようにする）。

    ⚠️ 既定値の «説明» をここ以外に書かないこと。2026-10-01 に `--radius-m` の help が
    «店提案と同じ半径» と言ったまま 40 倍ずれていた（アプリの既定は 500m）。
    `test_measure_dish_media_coverage.py` がアプリ側の定数と突き合わせている。
    """
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--schema", default="dev", help="対象スキーマ（既定: dev）")
    parser.add_argument(
        "--s2-level",
        type=int,
        default=coverage_sql.DEFAULT_S2_LEVEL,
        help=(
            "area 代表点の S2 level（既定: "
            f"{coverage_sql.DEFAULT_S2_LEVEL}。"
            "3_4_build_restaurant_catalog.py の --service-cell-level と揃える）"
        ),
    )
    parser.add_argument(
        "--radius-m",
        type=float,
        default=coverage_sql.DEFAULT_RADIUS_M,
        help=(
            "半径検索の半径（メートル。既定: "
            f"{coverage_sql.DEFAULT_RADIUS_M}）。"
            "⚠️ 既定値は本番の検索半径ではない。アプリの既定は 500m "
            "（app-expo/features/dishCategories/constants.ts の DEFAULT_SEARCH_RADIUS）で、"
            "本番ログの実測でも Google へ落ちた検索 2,065 通りのうち 1,772 通りが 500m だった。"
            "«ユーザーの検索が自社 DB で通るか» を測るなら --radius-m 500 --min-restaurants 1 で回すこと"
        ),
    )
    parser.add_argument(
        "--min-restaurants",
        type=int,
        default=coverage_sql.DEFAULT_MIN_RESTAURANTS,
        help=(
            "不足セルと判定する閾値（この店舗数未満。既定: "
            f"{coverage_sql.DEFAULT_MIN_RESTAURANTS}）。"
            "⚠️ 既定の 5 は #843 の完了条件の文言で、Google fallback の閾値ではない。"
            "fallback は dish-media/search が 0 件のときだけ起きる"
            "（app-expo/lib/dishMediaSearch.ts の `if (dishItems.length > 0) return`）ので、"
            "«fallback を避けられるか» を測るなら 1 を渡すこと"
        ),
    )
    parser.add_argument(
        "--statement-timeout-s",
        type=int,
        default=300,
        help="Stage5 の集計クエリに許す最大秒数（既定: 300）",
    )
    parser.add_argument(
        "--cell-batch-size",
        type=int,
        default=coverage_sql.DEFAULT_CELL_BATCH_SIZE,
        help=(
            f"Stage5 を何セルずつ集計するか（既定: {coverage_sql.DEFAULT_CELL_BATCH_SIZE} / 0 で一括）。"
            "⚠️ 速度ではなく «共有ディスクを食い潰さない» ための設定（#1782）"
        ),
    )
    parser.add_argument(
        "--temp-file-limit-mb",
        type=int,
        default=4096,
        help=(
            "Stage5 が書ける一時ファイルの上限（MB。既定: 4096 / 0 で指定しない）。"
            "dev と public は同じインスタンスなので、共有ディスクを埋める代わりに"
            "このクエリだけが落ちるようにする（#1782）"
        ),
    )
    parser.add_argument(
        "--out-json",
        default=None,
        help="結果 JSON の書き出し先（省略時はファイルへ書かない。標準出力へは常に出す）",
    )
    return parser


def parse_args() -> argparse.Namespace:
    return build_arg_parser().parse_args()


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

            area_table_name = coverage_sql.DEFAULT_AREA_CELLS_TABLE_NAME
            section("restaurants を S2 セルへ集計して一時テーブルへ materialize")
            build_area_cells_temp_table(cur, area_table_name, args.s2_level)

            driver_table_name = coverage_sql.DEFAULT_STAGE5_DRIVER_TABLE_NAME
            section("Stage5 の起点を (店, カテゴリ) へ畳んで一時テーブルへ materialize")
            build_stage5_driver_temp_table(cur, driver_table_name, table_name)

            # 一時テーブルの作成が終わった直後に read-only へ切り替える。
            # 以降（Stage4 / Stage5）は永続テーブルへの書き込みがセッションレベルで拒否される。
            cur.execute("SET default_transaction_read_only = on")
            logger.info("一時テーブル作成後、セッションを read-only に切り替えました")

            stage4_category_coverage = run_stage4(cur, table_name)
            stage5 = run_stage5(
                cur,
                driver_table_name,
                area_table_name,
                s2_level=args.s2_level,
                radius_m=args.radius_m,
                min_restaurants=args.min_restaurants,
                statement_timeout_s=args.statement_timeout_s,
                temp_file_limit_mb=args.temp_file_limit_mb,
                cell_batch_size=args.cell_batch_size,
            )

    result = {
        "measured_at": measured_at,
        "schema": args.schema,
        "assumptions": {
            "area_definition": (
                "restaurants の座標を S2 level s2_level のセルへ丸め、セル内restaurantsの"
                "重心を代表点とする。3_4_build_restaurant_catalog.py の "
                "S2_CELLIDFROMPOINT(location, @s2_level) と同じセル化（PostgreSQLにS2関数が"
                "無いため、s2_cell_id() で計算した結果をPython側から一時テーブルへ積んでいる）。"
                "店提案は中心点+半径の円検索であり area という単位自体はプロダクトに"
                "存在しないが、代表点の作り方はBigQuery側と揃えている（#1782 判断ログ参照）"
            ),
            "category_definition": (
                "dish_categories 全件（14,597件。#1782 で誤って134件と思い込んだ）ではなく、"
                "JP gateを通過したカテゴリのみ。8_1_validate_catalogs.py の "
                "target_categories CTE と同じ条件"
                "（feature_type='gate' AND feature_key='region:country:JP' AND score > 0）で "
                "dish_category_features を絞る"
            ),
            "usable_dish_media_definition": (
                "店提案側（dish-media.repository.ts findDishMediaIds / base_candidates CTE）"
                "の5条件。店舗詳細側（playback_status を見ない）とは定義が異なる"
            ),
            "stage3_excluded": "投稿を取得できる店舗数（BigQuery側。#1263/#1273）はこのスクリプトの対象外",
            "differs_from_8_1_validate_catalogs": (
                "8_1_validate_catalogs.py も同じ area(S2セル) x JP gate category の直積で "
                "coverage を測っているが、見る実体が違う（あちらはBigQueryのcatalog"
                "スナップショット、こちらはPostgreSQLの実データ）。詳細はこのスクリプトの"
                "モジュールdocstring「既存の coverage 計測との違い」を参照"
            ),
            "s2_level": args.s2_level,
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
