#!/usr/bin/env python3
"""#1947 深掘りの伸びしろの «測り方» を固定する。

influencer を補充する道が 2 本とも塞がった（検索＝無料枠切れ / @mention＝実測で否定）ので、
残る手は «既に良いと分かっているアカウントを深く掘る» になった。だが
**«投稿が増える» と «異なり店が増える» は別物**である。掘る前にここで測る。
"""
from __future__ import annotations

import importlib.util
import logging
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
_spec = importlib.util.spec_from_file_location("m77", HERE / "7_7_measure_deep_dive_headroom.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["m77"] = m
_spec.loader.exec_module(m)

SQL = m.build_sql("food-scroll.restaurant_recommendation")


class TheOutcomeIsDistinctStoresNotPostsTest(unittest.TestCase):
    def test_it_counts_distinct_delivered_stores_per_account(self):
        """同じ店を何度も投稿しているだけなら KPI は動かない。"""
        self.assertIn("COUNT(DISTINCT c.google_place_id) AS stores", SQL)
        self.assertIn("COUNT(DISTINCT r.post_id) AS posts", SQL)

    def test_the_cap_has_its_own_bucket(self):
        """`--limit-per-account 50` で切られた群を混ぜると «取り残し» が見えなくなる。"""
        self.assertIn((50, 50), m.BUCKETS)
        self.assertIn("WHEN posts BETWEEN 50 AND 50", SQL)

    def test_it_splits_by_account_type_to_peel_the_confound(self):
        """«投稿が多い» と «良いアカウント» は交絡する。種類で分けないと読めない。"""
        self.assertIn("account_type", SQL)
        self.assertIn("GROUP BY bucket, account_type", SQL)

    def test_a_handle_takes_the_type_of_its_first_discovery(self):
        self.assertIn("ROW_NUMBER() OVER (PARTITION BY handle", SQL)
        self.assertIn("WHERE rn = 1", SQL)

    def test_the_catalog_post_key_is_external_content_id(self):
        self.assertIn("external_content_id AS post_id", SQL)


class ItSaysWhatItCannotSayTest(unittest.TestCase):
    def test_the_report_refuses_to_claim_causation(self):
        rows = [{"bucket": "50-50", "account_type": "influencer", "accounts": 10,
                 "posts": 500, "stores": 300, "accounts_with_store": 9}]
        lines: list[str] = []
        h = logging.Handler()
        h.emit = lambda rec: lines.append(rec.getMessage())  # type: ignore[assignment]
        m.LOGGER.addHandler(h)
        m.LOGGER.setLevel(logging.INFO)
        try:
            m.report(rows)
        finally:
            m.LOGGER.removeHandler(h)
        body = "\n".join(lines)
        self.assertIn("観察であって実験ではない", body)
        self.assertIn("30.00", body, "300 店 / 10 アカウント = 30.00")


if __name__ == "__main__":
    unittest.main()
