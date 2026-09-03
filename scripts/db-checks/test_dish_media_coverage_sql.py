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
        sql = sut.build_stage5_top_cells_sql()
        self.assertIn("jp_gate_categories", sql)
        self.assertIn("region:country:JP", sql)
        self.assertNotIn("CROSS JOIN dish_categories c", sql)


class RadiusTest(unittest.TestCase):
    def test_custom_radius_is_reflected_in_st_dwithin(self) -> None:
        sql = sut.build_stage5_top_cells_sql(radius_m=12345)
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

    def test_matched_aggregation_starts_from_media_table_not_area_cells(self) -> None:
        sql = sut.build_stage5_top_cells_sql(
            area_table_name="area_cells_tmp", media_table_name="usable_dish_media_tmp"
        )
        self.assertIn("FROM usable_dish_media_tmp t", sql)
        self.assertIn("JOIN area_cells_tmp ac", sql)
        self.assertNotIn("CROSS JOIN", sql)
        self.assertNotIn("LEFT JOIN", sql)

    def test_old_full_cross_join_functions_are_gone(self) -> None:
        # 撤回した「area_cells起点・不足セルを1行ずつ返す」旧実装が復活していないことを保証する。
        self.assertFalse(hasattr(sut, "build_shortage_cells_sql"))
        self.assertFalse(hasattr(sut, "build_stage5_coverage_sql"))
        self.assertFalse(hasattr(sut, "_stage5_base_sql"))


class MinRestaurantsBucketTest(unittest.TestCase):
    """coverage を `min_restaurants` 以上/未満の2バケットに集計する build_stage5_summary_sql()
    と、0件は「全組み合わせ数 − 集計行数」の引き算で出す設計（16.8M行を列挙しない）を検査する。
    """

    def test_default_threshold_is_five_in_filter_clauses(self) -> None:
        sql = sut.build_stage5_summary_sql()
        self.assertIn(
            "count(*) FILTER (WHERE restaurants_with_usable_media >= 5)",
            sql,
        )
        self.assertIn(
            "count(*) FILTER (WHERE restaurants_with_usable_media < 5)",
            sql,
        )

    def test_custom_threshold_is_reflected_in_filter_clauses(self) -> None:
        sql = sut.build_stage5_summary_sql(min_restaurants=8)
        self.assertIn(
            "count(*) FILTER (WHERE restaurants_with_usable_media >= 8)",
            sql,
        )
        self.assertIn(
            "count(*) FILTER (WHERE restaurants_with_usable_media < 8)",
            sql,
        )

    def test_top_cells_query_has_no_threshold_filter(self) -> None:
        # min_restaurants は引数に取らない（閾値はバケット集計だけの関心事）
        sql = sut.build_stage5_top_cells_sql()
        self.assertNotIn("FILTER", sql)

    def test_summary_and_top_cells_reuse_the_same_matched_aggregation(self) -> None:
        # 集計本体（usable dish_media -> area_cells の JOIN + GROUP BY）が完全に同じ
        # 文字列であること。ここがズレていたら、バケット集計と上位セル一覧が
        # 別の定義で数えていることになる。
        matched_sql = sut._stage5_matched_sql(
            radius_m=sut.DEFAULT_RADIUS_M,
            area_table_name=sut.DEFAULT_AREA_CELLS_TABLE_NAME,
            media_table_name=sut.DEFAULT_TEMP_TABLE_NAME,
        )
        summary_sql = sut.build_stage5_summary_sql()
        top_cells_sql = sut.build_stage5_top_cells_sql()
        self.assertIn(matched_sql, summary_sql)
        self.assertIn(matched_sql, top_cells_sql)

    def test_top_cells_query_orders_by_coverage_descending_with_limit(self) -> None:
        sql = sut.build_stage5_top_cells_sql(top_n=20)
        self.assertIn("ORDER BY restaurants_with_usable_media DESC", sql)
        self.assertIn("LIMIT 20", sql)


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
            media_table_name=sut.DEFAULT_TEMP_TABLE_NAME,
        )
        self.assertIn(
            "ST_SetSRID(ST_MakePoint(ac.center_lng, ac.center_lat), 4326)::geography",
            matched_sql,
        )
        # 索引側は alias 無し、JOIN 条件側は alias(ac.) 付き — 列名部分が一致していること
        self.assertIn("center_lng, center_lat", "\n".join(index_stmts))


if __name__ == "__main__":
    unittest.main()
