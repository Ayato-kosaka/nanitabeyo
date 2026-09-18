#!/usr/bin/env python3
"""#1947 近傍の物差し（313 地点 × 500m）が黙って動かないことを固定する。

この物差しは 2026-09-09 から報告に使いながら **script として存在しなかった**ため、
2026-09-18 に過去の数字（3.393 / 66.1%）を再現できなかった。
**動かしてよいのは «測る対象のカタログ» だけで、物差しそのものは動かしてはいけない。**
"""
from __future__ import annotations

import ast
import importlib
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "measure_neighborhood_313", HERE / "7_4_measure_neighborhood_313.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["measure_neighborhood_313"] = m
_spec.loader.exec_module(m)

SOURCE = (HERE / "7_4_measure_neighborhood_313.py").read_text(encoding="utf-8")
SQL = m.build_sql("food-scroll.restaurant_recommendation", "food-scroll.wikidata_food_graph")


class TheYardstickIsFixedTest(unittest.TestCase):
    def test_the_sample_size_is_313(self):
        self.assertEqual(313, m.SAMPLE_N)

    def test_the_radius_matches_the_app(self):
        """アプリの検索半径（app-expo/features/dishCategories/constants.ts:13）と同じ 500m。"""
        self.assertEqual(500, m.RADIUS_M)

    def test_the_sample_catalog_run_is_pinned(self):
        self.assertEqual("restaurant-2026-08-23", m.SAMPLE_CATALOG_RUN_ID)

    def test_the_sample_is_deterministic(self):
        # 乱数を使うと run ごとに地点が変わり、過去と比較できない
        self.assertIn("FARM_FINGERPRINT", SQL)
        self.assertNotIn("RAND()", SQL)

    def test_the_sample_run_id_is_not_taken_from_latest(self):
        """«最新を引く» 仕掛けを入れてはいけない（他の台帳とは逆）。"""
        self.assertNotIn("latest_run_id", SOURCE)

    def test_only_the_measured_catalog_is_an_argument(self):
        self.assertIn('"--catalog-run-id"', SOURCE)
        for forbidden in ('"--sample-n"', '"--radius"', '"--radius-m"',
                          '"--sample-catalog-run-id"'):
            self.assertNotIn(forbidden, SOURCE,
                             f"{forbidden} を引数にすると物差しが run ごとに変わる")


class TheDefinitionIsNotCopiedTest(unittest.TestCase):
    def test_the_134_gate_comes_from_the_single_source(self):
        self.assertIn("kpi_gate_category_sql", SOURCE)

    def test_it_does_not_hardcode_the_gate_key(self):
        # ラベルや QID を写経すると #1815 の間違いを繰り返す
        self.assertNotIn("region:country:JP", SOURCE)

    def test_it_does_not_reimplement_the_quality_gate(self):
        self.assertNotIn("restaurant_confidence", SOURCE)


class GeographyIsNotGroupedTest(unittest.TestCase):
    """#1970 で 3 回踏んだ罠を、**既存の番人にそのまま聞く**。

    ⚠️ 判定を写経しない。`test_sql_geography_not_grouped.geography_violations` が正本で、
    ここで正規表現を書き直すと «本番だけ直ってテストが緑のまま» になる（CLAUDE.md）。
    """

    def test_the_generated_sql_passes_the_repo_wide_guard(self):
        guard = importlib.import_module("test_sql_geography_not_grouped")
        self.assertEqual([], guard.geography_violations(SQL))


class ItIsReadOnlyTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)):
                body = getattr(node, "body", [])
                if (body and isinstance(body[0], ast.Expr)
                        and isinstance(body[0].value, ast.Constant)
                        and isinstance(body[0].value.value, str)):
                    body[0].value.value = ""
        self.code = ast.unparse(tree)

    def test_it_never_writes(self):
        for dml in ("INSERT", "UPDATE", "DELETE", "CREATE TABLE", "load_json_rows"):
            self.assertNotIn(dml, self.code)

    def test_print_sql_does_not_need_bigquery(self):
        """認証の無い環境でも SQL を出せること（#1947 の 7_3 と同じ理由）。"""
        self.assertIn("--print-sql", SOURCE)
        # import が関数の中にあること（トップレベルだと接続無しで落ちる）
        top = [n for n in ast.parse(SOURCE).body
               if isinstance(n, (ast.Import, ast.ImportFrom))]
        names = [a.name for n in top for a in getattr(n, "names", [])]
        self.assertNotIn("google.cloud", names)
        self.assertFalse(any("pipeline_common" == getattr(n, "module", "") for n in top
                             if isinstance(n, ast.ImportFrom)))


class TheHistogramIsReportedTest(unittest.TestCase):
    """«あと 1 店で届くセル» を出すこと。施策の費用対効果がこれで決まる（#1947）。"""

    def test_near_threshold_cells_are_counted(self):
        for col in ("cells_at_4", "cells_at_3", "cells_ge5", "slots_to_reach5"):
            self.assertIn(col, SQL)

    def test_the_threshold_is_five_stores(self):
        self.assertIn("stores >= 5", SQL)


if __name__ == "__main__":
    unittest.main()
