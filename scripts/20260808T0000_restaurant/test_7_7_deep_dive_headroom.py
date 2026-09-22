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


class TheCandidatesAreChosenByEvidenceNotByLabelTest(unittest.TestCase):
    """種類ではなく実績で選ぶ。

    store_branch は帯が上がっても «店/アカ» が伸びない（0.74 → 1.06）。
    自分の店しか投稿しないので当然で、深掘りしても KPI は動かない。
    伸びるのは influencer 的な振る舞いのアカウントだけなので、**ラベルではなく
    «実際に何店 連れてきたか» で選ぶ**。
    """

    def test_candidates_need_both_posts_and_stores(self):
        sql = m.build_candidate_sql("food-scroll.restaurant_recommendation")
        self.assertIn(f"p.stores >= {m.DEEP_DIVE_MIN_STORES}", sql)
        self.assertIn(f"p.posts >= {m.DEEP_DIVE_MIN_POSTS}", sql)

    def test_the_threshold_matches_the_validated_judge(self):
        """4_20 の judge（25 投稿の probe で異なり店 4 以上）と同じ 4 店を使う。"""
        self.assertEqual(4, m.DEEP_DIVE_MIN_STORES)

    def test_it_says_candidates_are_not_ammunition(self):
        rows = [{"account_type": "unknown", "accounts": 100, "posts": 5000, "stores": 900}]
        lines: list[str] = []
        h = logging.Handler()
        h.emit = lambda rec: lines.append(rec.getMessage())  # type: ignore[assignment]
        m.LOGGER.addHandler(h)
        m.LOGGER.setLevel(logging.INFO)
        try:
            m.report_candidates(rows)
        finally:
            m.LOGGER.removeHandler(h)
        body = "\n".join(lines)
        self.assertIn("実弾ではない", body)
        self.assertIn("既に配信済みの店を採り直しても", body)


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
