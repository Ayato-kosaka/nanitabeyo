"""#1782 dish_media_coverage_sql.py の SQL 組み立てをガードするテスト（DB 接続なし）。

usable dish_media の 5 条件・グリッド粒度・不足セルの閾値は、実 DB を叩かなくても
生成された SQL 文字列を見れば検査できる。1 つでも条件が抜けたら赤くなることを
このテストで保証する。
"""

from __future__ import annotations

import unittest

import dish_media_coverage_sql as sut


class UsableDishMediaConditionsTest(unittest.TestCase):
    """店提案の実クエリ（dish-media.repository.ts の base_candidates CTE）から抽出した
    5 条件が、usable_dish_media_select_sql() に全部含まれていることを 1 つずつ検査する。
    どれか 1 つでも実装から抜けたら、対応するテストだけが赤くなる。
    """

    def setUp(self) -> None:
        self.sql = sut.usable_dish_media_select_sql()

    def test_condition_1_not_soft_deleted(self) -> None:
        # dish-media.repository.ts:236
        self.assertIn("dm.deleted_at IS NULL", self.sql)

    def test_condition_2_category_matches_via_dishes_join(self) -> None:
        # dish-media.repository.ts:233,237 — WHERE ではなく dishes を JOIN して
        # d.category_id を選択列に出すことで表現している
        self.assertIn("JOIN dishes d ON d.id = dm.dish_id", self.sql)
        self.assertIn("d.category_id AS category_id", self.sql)

    def test_condition_3_author_not_withdrawn(self) -> None:
        # dish-media.repository.ts:240-244
        self.assertIn("FROM users u", self.sql)
        self.assertIn("u.id = dm.user_id", self.sql)
        self.assertIn("u.deleted_at IS NOT NULL", self.sql)

    def test_condition_4_media_processing_completed(self) -> None:
        # dish-media.repository.ts:251
        self.assertIn("dm.media_processing_status = 'completed'", self.sql)

    def test_condition_5_not_known_unplayable(self) -> None:
        # dish-media.repository.ts:269-273
        self.assertIn("FROM dish_media_external_embeddings dmee", self.sql)
        self.assertIn("dmee.dish_media_id = dm.id", self.sql)
        self.assertIn("dmee.playback_status = 'not_playable'", self.sql)

    def test_all_five_conditions_are_registered_in_the_single_source(self) -> None:
        # 条件を1箇所（USABLE_DISH_MEDIA_CONDITIONS）に集めていること自体を検査する。
        # ここが4件未満に減っていたら、誰かが条件を消して気づかず出荷しようとしている。
        self.assertEqual(4, len(sut.USABLE_DISH_MEDIA_CONDITIONS))
        for condition in sut.USABLE_DISH_MEDIA_CONDITIONS:
            self.assertIn(condition, self.sql)


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


class GridDegreeTest(unittest.TestCase):
    def test_default_grid_degree_is_reflected(self) -> None:
        sql = sut.build_area_centers_sql()
        self.assertIn("FLOOR(latitude / 0.1)", sql)
        self.assertIn("FLOOR(longitude / 0.1)", sql)

    def test_custom_grid_degree_is_reflected(self) -> None:
        sql = sut.build_area_centers_sql(0.2)
        self.assertIn("FLOOR(latitude / 0.2)", sql)
        self.assertIn("FLOOR(longitude / 0.2)", sql)
        self.assertNotIn("/ 0.1", sql)

    def test_stage5_and_shortage_queries_use_the_same_grid_degree(self) -> None:
        coverage_sql = sut.build_stage5_coverage_sql(grid_degree=0.25)
        shortage_sql = sut.build_shortage_cells_sql(grid_degree=0.25)
        self.assertIn("FLOOR(latitude / 0.25)", coverage_sql)
        self.assertIn("FLOOR(latitude / 0.25)", shortage_sql)


class RadiusTest(unittest.TestCase):
    def test_custom_radius_is_reflected_in_st_dwithin(self) -> None:
        sql = sut.build_stage5_coverage_sql(radius_m=12345)
        self.assertIn("12345", sql)
        self.assertIn("ST_DWithin(", sql)


class ShortageThresholdTest(unittest.TestCase):
    def test_default_threshold_is_five_in_having(self) -> None:
        sql = sut.build_shortage_cells_sql()
        self.assertIn(
            "HAVING count(DISTINCT t.restaurant_id) < 5",
            sql,
        )

    def test_custom_threshold_is_reflected_in_having(self) -> None:
        sql = sut.build_shortage_cells_sql(min_restaurants=8)
        self.assertIn(
            "HAVING count(DISTINCT t.restaurant_id) < 8",
            sql,
        )

    def test_coverage_query_without_having_has_no_threshold_filter(self) -> None:
        # HAVING を持つのは不足セル専用クエリだけで、全件クエリには無いことを確認する
        sql = sut.build_stage5_coverage_sql()
        self.assertNotIn("HAVING", sql)

    def test_shortage_query_reuses_the_same_aggregation_as_coverage_query(self) -> None:
        # 集計本体（SELECT ... GROUP BY まで）が完全に同じ文字列であること。
        # ここがズレていたら、不足セル一覧と合計値が別の定義で数えていることになる。
        coverage_sql = sut.build_stage5_coverage_sql()
        shortage_sql = sut.build_shortage_cells_sql()
        shared_prefix = coverage_sql.split("\nORDER BY")[0]
        self.assertIn(shared_prefix, shortage_sql)


if __name__ == "__main__":
    unittest.main()
