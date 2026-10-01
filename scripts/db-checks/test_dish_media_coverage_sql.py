"""#1782 dish_media_coverage_sql.py の SQL 組み立てをガードするテスト（DB 接続なし）。

usable dish_media の 5 条件・S2 level・JP gate カテゴリ絞り込み・不足セルの閾値は、
実 DB を叩かなくても生成された SQL 文字列を見れば検査できる。1 つでも条件が抜けたら
赤くなることをこのテストで保証する。

area・category は当初グリッド近似 / dish_categories 全件（誤って134件と思い込んでいた）
で実装していたが、既存の定義（S2 level 14 セル / JP gate 通過カテゴリ）に合わせて直した。
このファイルの `S2LevelDefaultTest` / `JpGateCategoryTest` は、その既存定義から
数値・条件がズレていないことをソース同士の突き合わせで検査する（写経ではなく参照）。
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

# ⚠️ `python3 -m unittest scripts/db-checks/test_...py` のようにリポジトリルートから
#    呼ばれても import できるようにする（CI はこの形で回す。#1782 2026-10-01）。
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dish_media_coverage_sql as sut  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]


class UsableDishMediaConditionsTest(unittest.TestCase):
    """「使える dish_media」の判定を **このスクリプトが持っていない** ことを検査する。

    #1782 完了条件 3。以前はここに 4 条件を手で書き写しており、添えてあった行番号
    （dish-media.repository.ts:236 等）は #1798 と #1666 で行が動いた時点で既に
    指していなかった。**計測側が古い判定のまま緑を出し続けると、「Google を外せるか」の
    判断材料が静かに嘘になる。**

    正本は api/src/v1/dish-media/usable-dish-media-filter.ts で、jest が
    scripts/db-checks/sql/usable_dish_media_conditions.sql へ書き出している。
    """

    def setUp(self) -> None:
        self.sql = sut.usable_dish_media_select_sql()
        self.source = (
            REPO_ROOT
            / "api/src/v1/dish-media/usable-dish-media-filter.ts"
        ).read_text(encoding="utf-8")

    def test_conditions_come_from_the_generated_file(self) -> None:
        """条件は正本から書き出したファイルの中身がそのまま入っている。"""
        fragment = sut.usable_dish_media_conditions_sql()
        self.assertIn(fragment, self.sql)
        # 空のファイルを読んで «条件なし» で測ってしまう事故を潰す
        self.assertGreater(len(fragment.splitlines()), 4)

    def test_generated_file_matches_the_typescript_source(self) -> None:
        """書き出したファイルが本番の TypeScript と一致している。

        jest（usable-dish-media-filter.spec.snapshot.spec.ts）が同じことを検査しているが、
        **Python 側だけを回したときにも気付ける**ようにここでも見る。
        本番を直してスナップショットを書き出し忘れたら、ここが赤くなる。
        """
        for line in sut.usable_dish_media_conditions_sql().splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            self.assertIn(stripped, self.source)

    def test_category_matches_via_dishes_join(self) -> None:
        """5 条件目だけは WHERE ではなく JOIN で表現している（正本の断片には無い）。"""
        self.assertIn("JOIN dishes d ON d.id = dm.dish_id", self.sql)
        self.assertIn("d.category_id AS category_id", self.sql)

    def test_conditions_are_not_written_by_hand_here(self) -> None:
        """判定の文字列をこのモジュールが自前で持っていないこと。

        ⚠️ ここが本命。誰かが «ファイルを読むのは面倒だから» と書き戻したら赤くする。
        """
        module_source = (
            REPO_ROOT / "scripts/db-checks/dish_media_coverage_sql.py"
        ).read_text(encoding="utf-8")
        # コメント行（説明として名前を出しているもの）を除いた本体だけを見る
        body = "\n".join(
            line for line in module_source.splitlines() if not line.lstrip().startswith("#")
        )
        for forbidden in (
            "dm.deleted_at IS NULL",
            "media_processing_status = 'completed'",
            "playback_status = 'not_playable'",
        ):
            self.assertNotIn(forbidden, body)


class TempTableTest(unittest.TestCase):
    def test_temp_table_is_built_from_the_single_source_select(self) -> None:
        sql = sut.build_usable_dish_media_temp_table_sql("usable_dish_media_tmp")
        self.assertIn("CREATE TEMP TABLE usable_dish_media_tmp AS", sql)
        self.assertIn(sut.usable_dish_media_select_sql(), sql)

    def test_indexes_cover_both_join_keys(self) -> None:
        stmts = sut.build_usable_dish_media_temp_index_sql("usable_dish_media_tmp")
        joined = "\n".join(stmts)
        self.assertIn("USING GIST (location)", joined)
        self.assertIn("(category_id)", joined)


class Stage4Test(unittest.TestCase):
    def test_reads_from_temp_table_without_repeating_conditions(self) -> None:
        sql = sut.build_stage4_category_coverage_sql("usable_dish_media_tmp")
        self.assertIn("FROM usable_dish_media_tmp", sql)
        self.assertIn("GROUP BY category_id", sql)
        # Stage4 は一時テーブルを読むだけで、usable の条件文字列を再度書き下さない
        self.assertNotIn("media_processing_status", sql)
        self.assertNotIn("deleted_at", sql)


class Stage5ShortfallTest(unittest.TestCase):
    """#1782 完了条件2「不足セルが一覧で出る」。

    ⚠️ 「不足セル」を素直に «閾値に満たない全部» と読むと 1,646 万行になる
       （0 店舗 16,389,774 + 1〜4 店舗 77,779）。**一覧にしても打ち手は決まらない。**
       打ち手が決まるのは «1 件以上あるが届いていない» セルなので、そこを出す。

    ⚠️ **2026-10-01 以降、閾値と並べ替えは SQL ではなく {@link Stage5Accumulator} にある**
    （同じ重い集計を 4 回評価していたのをやめた。run 36820246635）。
    SQL 側に `HAVING` / `ORDER BY` / `LIMIT` が戻っていないことも併せて縛る。
    """

    def test_shortfall_only_lists_cells_that_have_at_least_one(self) -> None:
        # 集計本体は INNER JOIN なので 0 店舗のセルは最初から現れない。
        # そのうえで閾値未満へ絞る
        acc = sut.Stage5Accumulator(min_restaurants=5)
        acc.add_rows([(1, "A", 9), (2, "B", 4), (3, "C", 1)])
        self.assertEqual([(2, "B", 4), (3, "C", 1)], sorted(acc.shortfall_cells(), key=lambda r: r[0]))
        self.assertEqual(1, acc.covered_at_or_above_min)
        self.assertEqual(2, acc.covered_below_min)
        self.assertEqual(3, acc.covered_total)

    def test_shortfall_cells_are_ordered_closest_to_the_threshold_first(self) -> None:
        # «いちばん惜しいものから潰す» ための並び
        acc = sut.Stage5Accumulator(min_restaurants=5)
        acc.add_rows([(1, "A", 1), (2, "B", 4), (3, "C", 2)])
        self.assertEqual([(2, "B", 4), (3, "C", 2), (1, "A", 1)], acc.shortfall_cells())

    def test_shortfall_respects_a_custom_threshold(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=3)
        acc.add_rows([(1, "A", 3), (2, "B", 2)])
        self.assertEqual([(2, "B", 2)], acc.shortfall_cells())
        self.assertEqual(1, acc.covered_at_or_above_min)

    def test_shortfall_by_category_rolls_up_for_deciding_what_to_work_on(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=5)
        acc.add_rows([(1, "A", 1), (2, "A", 2), (3, "B", 1), (4, "A", 9)])
        # (category_id, shortfall_cells, covered_cells, best_cell_restaurants)
        self.assertEqual([("A", 2, 1, 9), ("B", 1, 0, 1)], acc.shortfall_by_category())

    def test_shortfall_by_category_hides_categories_with_no_shortfall(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=5)
        acc.add_rows([(1, "A", 9)])
        self.assertEqual([], acc.shortfall_by_category())

    def test_sql_does_not_carry_the_threshold_or_the_ordering(self) -> None:
        """⚠️ 2 箇所に書かないこと。書くと片方だけ直り、テストが緑のまま嘘を守る。"""
        sql = sut.build_stage5_matched_rows_sql()
        for forbidden in ("HAVING", "ORDER BY", "LIMIT", "FILTER (WHERE"):
            self.assertNotIn(forbidden, sql)

class S2LevelDefaultTest(unittest.TestCase):
    """area の単位はグリッド近似ではなく S2 セル。既定 level は新しく決めるのではなく、
    3_4_build_restaurant_catalog.py の `--service-cell-level` 既定値に合わせる。
    ここでは重い依存（google-cloud-bigquery）を読み込まずに済むよう、実行はせず
    ソーステキストを正規表現で突き合わせる。
    """

    def test_default_s2_level_matches_service_cell_level_default(self) -> None:
        catalog_script = (
            REPO_ROOT
            / "scripts/20260808T0000_restaurant/3_4_build_restaurant_catalog.py"
        )
        source = catalog_script.read_text(encoding="utf-8")
        match = re.search(r'"--service-cell-level".*?default=(\d+)', source, re.DOTALL)
        self.assertIsNotNone(
            match,
            "3_4_build_restaurant_catalog.py の --service-cell-level 既定値が見つからない"
            "（ファイル構成が変わった場合はこのテストの正規表現を追随させること）",
        )
        self.assertEqual(int(match.group(1)), sut.DEFAULT_S2_LEVEL)


class AreaCellsTempTableTest(unittest.TestCase):
    def test_temp_table_has_s2_cell_id_and_centroid_columns(self) -> None:
        sql = sut.build_area_cells_temp_table_sql("area_cells_tmp")
        self.assertIn("CREATE TEMP TABLE area_cells_tmp", sql)
        self.assertIn("s2_cell_id BIGINT", sql)
        self.assertIn("center_lat", sql)
        self.assertIn("center_lng", sql)
        self.assertIn("restaurant_count", sql)

    def test_no_grid_based_definition_remains(self) -> None:
        # #1782 で撤回したグリッド近似（FLOOR(lat/cell)）が復活していないことを保証する。
        self.assertFalse(hasattr(sut, "build_area_centers_sql"))
        self.assertFalse(hasattr(sut, "DEFAULT_GRID_DEGREE"))


class JpGateCategoryTest(unittest.TestCase):
    """8_1_validate_catalogs.py の `target_categories` CTE と同じ条件で絞っているかを
    検査する。dish_categories 全件（誤って134件と思い込んでいた実体）を使っていないことも
    合わせて保証する。
    """

    def setUp(self) -> None:
        self.sql = sut.jp_gate_category_select_sql()

    def test_filters_by_gate_feature_type_and_jp_key_and_positive_score(self) -> None:
        self.assertIn("feature_type = 'gate'", self.sql)
        self.assertIn("feature_key = 'region:country:JP'", self.sql)
        self.assertIn("score > 0", self.sql)

    def test_reads_from_dish_category_features_not_all_categories(self) -> None:
        self.assertIn("FROM dish_category_features f", self.sql)
        self.assertIn("FROM dish_categories c", self.sql)

    def test_condition_values_match_8_1_validate_catalogs_source(self) -> None:
        # 写経ではなく参照であることを保証する: 8_1_validate_catalogs.py 側の
        # target_categories CTE が使っている値と、ここで使っている値を突き合わせる。
        validate_script = (
            REPO_ROOT / "scripts/20260808T0000_restaurant/8_1_validate_catalogs.py"
        )
        source = validate_script.read_text(encoding="utf-8")
        self.assertIn("target_categories AS", source)
        self.assertIn(f"feature_type = '{sut.JP_GATE_FEATURE_TYPE}'", source)
        self.assertIn(f"feature_key = '{sut.JP_GATE_FEATURE_KEY}'", source)
        self.assertIn("score > 0", source)

    def test_stage5_uses_jp_gate_categories_not_all_dish_categories(self) -> None:
        """JP gate の絞り込みは **起点を畳む側**（driver 一時テーブル）に移した。

        ⚠️ 移した先で絞っていることを確かめる。Stage5 の集計本体から
        `jp_gate_categories` が消えただけを見て «絞らなくなった» と読まないため、
        driver の SQL に対して同じ 3 点を当てる。
        """
        driver_sql = sut.build_stage5_driver_temp_table_sql()
        self.assertIn("jp_gate_categories", driver_sql)
        self.assertIn("region:country:JP", driver_sql)
        self.assertNotIn("CROSS JOIN dish_categories c", driver_sql)
        # 集計本体は driver を読むだけ（絞り込みを二重に書かない）
        self.assertNotIn("jp_gate_categories", sut.build_stage5_matched_rows_sql())


class RadiusTest(unittest.TestCase):
    def test_custom_radius_is_reflected_in_st_dwithin(self) -> None:
        sql = sut.build_stage5_matched_rows_sql(radius_m=12345)
        self.assertIn("12345", sql)
        self.assertIn("ST_DWithin(", sql)


class Stage5InvertedJoinTest(unittest.TestCase):
    """#1782 Stage5 が 300 秒でタイムアウトした事故
    （run: https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33698994719）の修正。

    旧実装は `area_cells CROSS JOIN jp_gate_categories`（dev実測1,686万行）を先に作って
    usable dish_media を LEFT JOIN していた。新実装は起点を逆にし、usable dish_media
    （高々数千行）から area_cells / jp_gate_categories へ INNER JOIN で辿る。
    このテストは、その向きが逆戻りしていないことを生成された SQL 文字列で検査する。
    """

    def test_matched_aggregation_starts_from_the_driver_not_area_cells(self) -> None:
        sql = sut.build_stage5_matched_rows_sql(
            area_table_name="area_cells_tmp", driver_table_name="stage5_driver_tmp"
        )
        self.assertIn("FROM stage5_driver_tmp t", sql)
        self.assertIn("JOIN area_cells_tmp ac", sql)
        self.assertNotIn("CROSS JOIN", sql)
        self.assertNotIn("LEFT JOIN", sql)

    def test_aggregation_does_not_reference_a_table_it_no_longer_joins(self) -> None:
        """⚠️ 2026-10-01 に **実際に取り残した**。起点を driver へ移したとき、
        `ORDER BY ... c.category_id` だけが消えた別名 `c` を指したまま残っていた
        （テストが拾ったので DB へは出ていない）。別名は driver の `t` だけである。
        """
        sql = sut.build_stage5_matched_rows_sql()
        self.assertNotIn("c.category_id", sql)
        self.assertNotIn("c.category_label", sql)

    def test_aggregation_no_longer_needs_count_distinct(self) -> None:
        """#1782 2026-10-01 の DiskFull。

        半径 20km の `ST_DWithin` は 1 行が数千セルに当たるので、起点の行数が
        そのまま中間結果の倍率になる。起点を (店, カテゴリ) へ畳んだので
        `count(DISTINCT ...)`（溢れるのはここ）は要らない。
        ⚠️ `count(DISTINCT` が戻ってきたら、起点の畳み込みが壊れたサインである。
        """
        sql = sut.build_stage5_matched_rows_sql()
        self.assertNotIn("count(DISTINCT", sql)
        self.assertIn("count(*) AS restaurants_with_usable_media", sql)

    def test_old_full_cross_join_functions_are_gone(self) -> None:
        # 撤回した「area_cells起点・不足セルを1行ずつ返す」旧実装が復活していないことを保証する。
        self.assertFalse(hasattr(sut, "build_shortage_cells_sql"))
        self.assertFalse(hasattr(sut, "build_stage5_coverage_sql"))
        self.assertFalse(hasattr(sut, "_stage5_base_sql"))
        # ⚠️ #1782 2026-10-01: 同じ重い集計を 4 回評価する形へ戻っていないこと
        #    （run 36820246635 は 65 分でも終わらなかった）
        for removed in (
            "build_stage5_summary_sql",
            "build_stage5_top_cells_sql",
            "build_stage5_shortfall_cells_sql",
            "build_stage5_shortfall_by_category_sql",
        ):
            self.assertFalse(hasattr(sut, removed), removed)


class Stage5DriverTest(unittest.TestCase):
    """#1782 2026-10-01 の DiskFull の修正。起点を «(店, カテゴリ) 1 行» へ畳む。

    `count(*)` が元の `count(DISTINCT t.restaurant_id)` と同じ値になるのは、
    **driver が (restaurant_id, category_id) ごとに 1 行**で、その location が
    **店の座標（`r.location`）**だからである。この 2 つが前提なので、ここで縛る。
    """

    def test_driver_is_distinct_on_restaurant_and_category(self) -> None:
        sql = sut.build_stage5_driver_temp_table_sql()
        self.assertIn("SELECT DISTINCT", sql)
        for column in ("t.restaurant_id", "c.category_id", "c.category_label", "t.location"):
            self.assertIn(column, sql)

    def test_driver_location_is_the_restaurant_location(self) -> None:
        """⚠️ ここが投稿側の列へ変わると count(*) は count(DISTINCT) と一致しなくなる。"""
        self.assertIn("r.location AS location", sut.usable_dish_media_select_sql())

    def test_driver_reads_the_usable_temp_table_and_does_not_repeat_the_conditions(self) -> None:
        sql = sut.build_stage5_driver_temp_table_sql()
        self.assertIn(f"FROM {sut.DEFAULT_TEMP_TABLE_NAME} t", sql)
        # 本番の 5 条件は usable 一時テーブル側にしか書かない
        self.assertNotIn("playback_status", sql)

    def test_driver_indexes_cover_both_join_keys(self) -> None:
        indexes = sut.build_stage5_driver_temp_index_sql()
        self.assertTrue(any("USING GIST (location)" in sql for sql in indexes))
        self.assertTrue(any("(category_id)" in sql for sql in indexes))

    def test_driver_table_name_differs_from_the_usable_table(self) -> None:
        self.assertNotEqual(sut.DEFAULT_STAGE5_DRIVER_TABLE_NAME, sut.DEFAULT_TEMP_TABLE_NAME)


class Stage5AccumulatorTest(unittest.TestCase):
    """#1782 件数バケット・上位セルを «1 回の集計結果から» 作る（run 36820246635 の修正）。

    ⚠️ **バッチをまたいで足せるのはセルで割っているからである。** セルはどのバッチにも
    1 回しか現れないので、足し算・上位 N の再選択・キーごとの最大値で一括と同じ値になる。
    """

    def test_default_threshold_is_five(self) -> None:
        acc = sut.Stage5Accumulator()
        self.assertEqual(sut.DEFAULT_MIN_RESTAURANTS, acc.min_restaurants)
        acc.add_rows([(1, "A", 5), (2, "B", 4)])
        self.assertEqual(1, acc.covered_at_or_above_min)
        self.assertEqual(1, acc.covered_below_min)

    def test_custom_threshold_is_respected(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=8)
        acc.add_rows([(1, "A", 8), (2, "B", 7)])
        self.assertEqual(1, acc.covered_at_or_above_min)
        self.assertEqual(1, acc.covered_below_min)

    def test_top_cells_have_no_threshold_filter(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=5)
        acc.add_rows([(1, "A", 9), (2, "B", 1)])
        self.assertEqual([(1, "A", 9), (2, "B", 1)], acc.top_cells())

    def test_top_cells_are_ordered_by_coverage_descending_with_limit(self) -> None:
        acc = sut.Stage5Accumulator(min_restaurants=5, top_n=2)
        acc.add_rows([(1, "A", 3), (2, "B", 9), (3, "C", 7)])
        self.assertEqual([(2, "B", 9), (3, "C", 7)], acc.top_cells())

    def test_batches_add_up_to_the_same_numbers_as_one_pass(self) -> None:
        """⚠️ これが崩れたら分割の前提（セルで割る）が壊れている。"""
        rows = [(1, "A", 9), (2, "A", 2), (3, "B", 6), (4, "B", 1), (5, "C", 5)]
        one_pass = sut.Stage5Accumulator(min_restaurants=5, top_n=3)
        one_pass.add_rows(rows)
        batched = sut.Stage5Accumulator(min_restaurants=5, top_n=3)
        batched.add_rows(rows[:2])
        batched.add_rows(rows[2:4])
        batched.add_rows(rows[4:])
        self.assertEqual(one_pass.covered_at_or_above_min, batched.covered_at_or_above_min)
        self.assertEqual(one_pass.covered_below_min, batched.covered_below_min)
        self.assertEqual(one_pass.covered_total, batched.covered_total)
        self.assertEqual(one_pass.top_cells(), batched.top_cells())
        self.assertEqual(one_pass.shortfall_cells(), batched.shortfall_cells())
        self.assertEqual(one_pass.shortfall_by_category(), batched.shortfall_by_category())

    def test_only_the_top_n_rows_are_kept_in_memory(self) -> None:
        """dev では非ゼロの組み合わせが 600 万行オーダーある。全行を抱えない。"""
        acc = sut.Stage5Accumulator(min_restaurants=5, top_n=3)
        acc.add_rows([(i, "A", i) for i in range(1, 1001)])
        self.assertEqual(3, len(acc.top_cells()))
        self.assertEqual(3, len(acc.shortfall_cells()))
        self.assertEqual(1000, acc.covered_total)

class AreaCellsGistIndexTest(unittest.TestCase):
    """Stage5 は usable dish_media 側から area_cells へ ST_DWithin を投げる向きになったため、
    area_cells 側の代表点に GiST 式索引が無いと、起点行数 × 全 area_cells 件数の
    ネステッドループになってしまう。索引の式と JOIN 条件の式が一致していることを検査する
    （ズレていると索引が使われず全件スキャンに戻る）。
    """

    def test_index_uses_gist_on_the_centroid_expression(self) -> None:
        stmts = sut.build_area_cells_temp_index_sql("area_cells_tmp")
        joined = "\n".join(stmts)
        self.assertIn("USING GIST", joined)
        self.assertIn(
            "ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography",
            joined,
        )

    def test_index_expression_matches_the_join_condition_expression(self) -> None:
        index_stmts = sut.build_area_cells_temp_index_sql("area_cells_tmp")
        matched_sql = sut._stage5_matched_sql(
            radius_m=sut.DEFAULT_RADIUS_M,
            area_table_name="area_cells_tmp",
            driver_table_name=sut.DEFAULT_STAGE5_DRIVER_TABLE_NAME,
        )
        self.assertIn(
            "ST_SetSRID(ST_MakePoint(ac.center_lng, ac.center_lat), 4326)::geography",
            matched_sql,
        )
        # 索引側は alias 無し、JOIN 条件側は alias(ac.) 付き — 列名部分が一致していること
        self.assertIn("center_lng, center_lat", "\n".join(index_stmts))


if __name__ == "__main__":
    unittest.main()
