#!/usr/bin/env python3
"""#1947 経路ごとの歩留まりの «数え方» を固定する。

過去に外した形を 3 つ封じる:
1. **候補数を実弾として報告した**（#1970「593 軒」→ 実際 73 件）→ 分母は «呼んだ» アカウント
2. **matched を成果として数えた**（KPI は異なり店の閾値関数）→ 成果は配信カタログの異なり店
3. **重複発見の handle を両方の経路に数えた** → 1 handle = 最初に発見した run だけ
"""
from __future__ import annotations

import importlib.util
import logging
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
_spec = importlib.util.spec_from_file_location("m76", HERE / "7_6_measure_route_yield.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["m76"] = m
_spec.loader.exec_module(m)

SQL = m.build_sql("food-scroll.restaurant_recommendation")


class TheCountingRulesAreFixedTest(unittest.TestCase):
    def test_a_handle_is_attributed_to_its_first_discovery_run(self):
        self.assertIn("ROW_NUMBER() OVER (PARTITION BY handle", SQL)
        self.assertIn("WHERE rn = 1", SQL)

    def test_the_denominator_is_attempted_accounts_not_stock(self):
        """在庫を分母にすると «まだ呼んでいない経路» が不当に悪く見える。"""
        self.assertIn("sns_account_attempt", SQL)
        self.assertIn("IF(a.handle IS NOT NULL, ro.handle, NULL)", SQL)

    def test_handles_with_posts_count_as_called_even_without_the_ledger(self):
        """台帳（#1815 以降）だけを分母にすると、古い経路が «0 件呼んで 2 万店» になる。"""
        self.assertIn("UNION DISTINCT", SQL)
        self.assertIn("SELECT DISTINCT account_id FROM `food-scroll.restaurant_recommendation"
                      ".sns_post_raw`", SQL)

    def test_it_shows_how_many_handles_a_route_only_re_registered(self):
        """«登録 − 新規» が大きい経路は、射程を広げずに同じ handle を入れ直しただけ。"""
        self.assertIn("registered AS (", SQL)

    def test_the_outcome_is_distinct_delivered_stores_not_matched_rows(self):
        self.assertIn("sns_dish_media_catalog", SQL)
        self.assertIn("COUNT(DISTINCT p.google_place_id)", SQL)
        self.assertNotIn("status='matched'", SQL.replace(" ", ""))

    def test_the_catalog_post_key_is_external_content_id(self):
        """配信カタログ側の投稿キーは `post_id` ではない（2026-09-22 に 400 で落ちた）。"""
        self.assertIn("external_content_id AS post_id", SQL)

    def test_it_separates_stores_only_this_route_delivered(self):
        """重なる店はその経路を止めても失われない。止めてよいかは独占店で見る。"""
        self.assertIn("n_routes = 1", SQL)


class ItRefusesToReportWhenItCannotMeasureTest(unittest.TestCase):
    def test_per_account_yield_uses_attempted_as_the_denominator(self):
        rows = [{"run_id": "r1", "discovery_method": "fsq", "registered": 1200,
                 "discovered": 1000, "attempted": 100, "posts": 500,
                 "delivered_stores": 50, "exclusive_stores": 40}]
        lines: list[str] = []
        h = logging.Handler()
        h.emit = lambda rec: lines.append(rec.getMessage())  # type: ignore[assignment]
        m.LOGGER.addHandler(h)
        m.LOGGER.setLevel(logging.INFO)
        try:
            m.report(rows, accounts_per_hour=205.0)
        finally:
            m.LOGGER.removeHandler(h)
        body = "\n".join(lines)
        self.assertIn("0.50", body, "50 店 / 呼んだ 100 = 0.50（在庫 1000 ではない）")
        self.assertIn("残     900 件", body)

    def test_a_route_that_was_never_called_is_not_reported_as_zero_yield(self):
        """1 度も呼んでいない経路に «見込み 0» と書くと、良い燃料を捨てる。"""
        rows = [{"run_id": "new", "discovery_method": "fsq", "registered": 15984,
                 "discovered": 15984, "attempted": 0, "posts": 0,
                 "delivered_stores": 0, "exclusive_stores": 0}]
        lines: list[str] = []
        h = logging.Handler()
        h.emit = lambda rec: lines.append(rec.getMessage())  # type: ignore[assignment]
        m.LOGGER.addHandler(h)
        m.LOGGER.setLevel(logging.INFO)
        try:
            m.report(rows, accounts_per_hour=205.0)
        finally:
            m.LOGGER.removeHandler(h)
        self.assertIn("歩留まり未測定", "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
