"""#1774 «価格付きレビュー» の判定が 1 箇所に集約されていることを検査する（DB 不要）。

このスクリプトの値打ちは «price_cents が入っている生きているレビュー» の見分け方が
1 箇所にしか無いことなので、そこをガードする。写経が増えた時点で数字が静かにズレ始める
（CLAUDE.md「本番のロジックをテストへ写経しない」/ `test_measure_review_coverage.py` と同じ作り）。
"""

import unittest

import measure_price_coverage as m


class PricedReviewSingleSourceTest(unittest.TestCase):
    def test_priced_review_predicate_combines_alive_and_price_present(self):
        self.assertIn(m.ALIVE_PREDICATE, m.PRICED_REVIEW_PREDICATE)
        self.assertIn(m.PRICE_PRESENT_PREDICATE, m.PRICED_REVIEW_PREDICATE)

    def test_alive_predicate_is_deleted_at_is_null(self):
        self.assertEqual(m.ALIVE_PREDICATE, "dr.deleted_at IS NULL")

    def test_price_present_predicate_is_price_cents_is_not_null(self):
        self.assertEqual(m.PRICE_PRESENT_PREDICATE, "dr.price_cents IS NOT NULL")

    def test_every_priced_sql_builder_uses_the_single_source(self):
        """«価格付きレビュー» を対象にする各 SQL が PRICED_REVIEW_PREDICATE をそのまま
        埋めていること。ここを «その場で書いた同等の条件» に差し替えると赤くなる。
        """
        for sql in (
            m.build_currency_breakdown_sql(),
            m.build_pair_coverage_sql(),
            m.build_restaurants_with_priced_reviews_sql(),
            m.build_price_distribution_sql(),
            m.build_recency_buckets_sql(),
        ):
            self.assertIn(m.PRICED_REVIEW_PREDICATE, sql)

    def test_totals_sql_uses_alive_predicate_as_where_and_price_present_as_filter(self):
        """build_totals_sql は分母を ALIVE_PREDICATE で絞り、分子を PRICE_PRESENT_PREDICATE
        の FILTER で数える（PRICED_REVIEW_PREDICATE をそのまま WHERE に置くと分母まで
        価格付きに絞られてしまい、充足率が測れなくなる）。
        """
        sql = m.build_totals_sql()
        self.assertIn(f"WHERE {m.ALIVE_PREDICATE}", sql)
        self.assertIn(f"FILTER (WHERE {m.PRICE_PRESENT_PREDICATE})", sql)

    def test_deleted_reviews_are_excluded_from_every_priced_query(self):
        """論理削除された行を «価格付きレビュー» に数えると、実際に見えているレビューとズレる。"""
        for sql in (
            m.build_totals_sql(),
            m.build_currency_breakdown_sql(),
            m.build_pair_coverage_sql(),
            m.build_restaurants_with_priced_reviews_sql(),
            m.build_price_distribution_sql(),
            m.build_recency_buckets_sql(),
        ):
            self.assertIn(m.ALIVE_PREDICATE, sql)

    def test_restaurant_counts_go_through_dishes(self):
        """dish_reviews は dish にぶら下がるので、店舗単位は dishes 経由でしか数えられない。"""
        for sql in (
            m.build_pair_coverage_sql(),
            m.build_restaurants_with_priced_reviews_sql(),
        ):
            self.assertIn("JOIN dishes d ON d.id = dr.dish_id", sql)
            self.assertIn("d.restaurant_id", sql)

    def test_pair_coverage_groups_by_restaurant_and_category(self):
        sql = m.build_pair_coverage_sql()
        self.assertIn("GROUP BY d.restaurant_id, d.category_id", sql)
        self.assertIn("pairs_with_1_or_more", sql)
        self.assertIn("pairs_with_3_or_more", sql)
        self.assertIn("priced_count >= 3", sql)

    def test_recency_buckets_use_created_at_not_eaten_at(self):
        """鮮度の基準は created_at。eaten_at（食べた日）を混ぜると
        «レビューがいつ記録されたか» という質問に答えられなくなる。
        """
        sql = m.build_recency_buckets_sql()
        self.assertIn("dr.created_at", sql)
        self.assertNotIn("eaten_at", sql)

    def test_price_distribution_does_not_round_raw_values(self):
        """外れ値判断の材料なので、丸め（round / ::int キャストでの丸め等）をしない。"""
        sql = m.build_price_distribution_sql()
        self.assertNotIn("round(", sql.lower())
        self.assertIn("percentile_cont(0.25)", sql)
        self.assertIn("percentile_cont(0.5)", sql)
        self.assertIn("percentile_cont(0.75)", sql)
        self.assertIn("min(dr.price_cents)", sql)
        self.assertIn("max(dr.price_cents)", sql)


if __name__ == "__main__":
    unittest.main()
