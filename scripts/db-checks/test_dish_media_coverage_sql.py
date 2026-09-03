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
import unittest
from pathlib import Path

import dish_media_coverage_sql as sut

REPO_ROOT = Path(__file__).resolve().parents[2]


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
        sql = sut.build_stage5_coverage_sql()
        self.assertIn("jp_gate_categories", sql)
        self.assertIn("region:country:JP", sql)
        self.assertNotIn("CROSS JOIN dish_categories c", sql)


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
