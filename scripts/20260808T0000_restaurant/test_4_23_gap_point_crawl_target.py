#!/usr/bin/env python3
"""#1947 «合格線に足りない地点の近くで handle を掘る» 対象の選び方を固定する。

2026-09-22 の実測で、合格線に足りない 33 地点は **1 件も呼べる handle が残っていない**
一方、**«handle すら知らない店» は 2,662 店**あると分かった。つまり律速は IG のクォータ
ではなく handle そのもので、次の一手は収集ではなく巡回である。

この試験が守るのは 2 つ。

1. **どの地点が足りないかの判定を写経しない**（`7_5.select_gap_points` が唯一の入口）
2. **handle を既に知っている店を巡回対象に入れない**（巡回は handle を掘るためのもの。
   知っている店を混ぜると «巡回しても handle が増えない» に見える）
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("m423", HERE / "4_23_target_gap_point_stores.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["m423"] = m
_spec.loader.exec_module(m)

SRC = (HERE / "4_23_target_gap_point_stores.py").read_text(encoding="utf-8")
SQL = m.build_sql("food-scroll.restaurant_recommendation", radius_m=500)


class TheTargetsAreStoresWeHaveNoHandleForTest(unittest.TestCase):
    def test_it_excludes_stores_whose_handle_is_already_known(self):
        self.assertIn("handled AS (", SQL)
        self.assertIn("WHERE h.gpid IS NULL", SQL)

    def test_it_requires_a_website_to_crawl(self):
        self.assertIn("s.website IS NOT NULL", SQL)

    def test_the_radius_comes_from_the_yardstick(self):
        self.assertIn("500)", SQL)
        self.assertIn("800)", m.build_sql("d", radius_m=800))

    def test_it_uses_the_pinned_sample_catalog_for_coordinates(self):
        """座標を別 run から引くと «2,662 店» と実際の対象がずれる。"""
        self.assertIn("@geo_rid", SQL)
        self.assertIn("SAMPLE_CATALOG_RUN_ID", SRC)
        self.assertNotIn("restaurant-2026-08-23", SRC)


class ItDoesNotReinventTheOtherScriptsTest(unittest.TestCase):
    def test_which_points_are_short_is_decided_by_seven_five(self):
        self.assertIn("select_gap_points", SRC)

    def test_it_targets_every_short_point_not_only_the_ones_with_ammunition(self):
        """弾が無い地点こそ巡回の対象である。reachable_only=True で絞ると全部落ちる。"""
        self.assertIn("reachable_only=False", SRC)

    def test_the_row_shape_comes_from_four_sixteen(self):
        """`sns_site_crawl_target` の行形式を写経しない（4_4 が読めなくなる）。"""
        self.assertIn("build_site_crawl_target_rows", SRC)
        self.assertIn("CREATE_SITE_CRAWL_TARGET_SQL", SRC)

    def test_zero_targets_is_reported_as_a_thin_ledger_not_a_useless_crawl(self):
        self.assertIn("店台帳そのものが薄い", SRC)


if __name__ == "__main__":
    unittest.main()
