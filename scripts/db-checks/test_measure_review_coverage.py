"""#1264 レビュー出所の判定が 1 箇所に集約されていることを検査する（DB 不要）。

このスクリプトの値打ちは «自社UGC と Google 取り込みの見分け方» が
1 箇所にしか無いことなので、そこをガードする。写経が増えた時点で
数字が静かにズレ始める（CLAUDE.md「本番のロジックをテストへ写経しない」）。
"""

import unittest

import measure_review_coverage as m


class ReviewOriginSingleSourceTest(unittest.TestCase):
    def test_origin_predicates_are_exactly_two(self):
        self.assertEqual(
            sorted(m.REVIEW_ORIGIN_PREDICATES), ["google_import", "own_ugc"]
        )

    def test_own_ugc_requires_user_id_and_excludes_imported(self):
        pred = m.REVIEW_ORIGIN_PREDICATES["own_ugc"]
        self.assertIn("dr.user_id IS NOT NULL", pred)
        self.assertIn("dr.imported_user_name IS NULL", pred)

    def test_google_import_is_identified_by_imported_user_name(self):
        self.assertIn(
            "dr.imported_user_name IS NOT NULL",
            m.REVIEW_ORIGIN_PREDICATES["google_import"],
        )

    def test_every_sql_builder_uses_the_single_source(self):
        """各 SQL が REVIEW_ORIGIN_PREDICATES の文字列をそのまま埋めていること。

        ここを «その場で書いた同等の条件» に差し替えると赤くなる。
        """
        own = m.REVIEW_ORIGIN_PREDICATES["own_ugc"]
        google = m.REVIEW_ORIGIN_PREDICATES["google_import"]

        totals = m.build_totals_sql()
        self.assertIn(own, totals)
        self.assertIn(google, totals)

        google_only = m.build_google_only_restaurants_sql()
        self.assertIn(own, google_only)
        self.assertIn(google, google_only)

        self.assertIn(own, m.build_reviewers_sql())
        self.assertIn(own, m.build_restaurants_with_reviews_sql("own_ugc"))

    def test_deleted_rows_are_excluded_everywhere(self):
        """論理削除された行を数えると «実際に見えているレビュー» とズレる。"""
        for sql in (
            m.build_totals_sql(),
            m.build_google_only_restaurants_sql(),
            m.build_reviewers_sql(),
            m.build_restaurants_with_reviews_sql(None),
        ):
            self.assertIn(m.ALIVE_PREDICATE, sql)

    def test_restaurant_counts_go_through_dishes(self):
        """dish_reviews は dish にぶら下がるので、店舗単位は dishes 経由でしか数えられない。"""
        for sql in (
            m.build_google_only_restaurants_sql(),
            m.build_restaurants_with_reviews_sql(None),
        ):
            self.assertIn("JOIN dishes d ON d.id = dr.dish_id", sql)
            self.assertIn("d.restaurant_id", sql)

    def test_google_only_bucket_requires_zero_own_ugc(self):
        """«Google のレビューしか無い店» は own_ugc = 0 でなければならない。

        ここが > 0 や省略になっていると、自社UGCも持つ店まで
        «消える店» に数えてしまい、判断材料が過大になる。
        """
        sql = m.build_google_only_restaurants_sql()
        self.assertIn("google_import > 0 AND own_ugc = 0", sql)


if __name__ == "__main__":
    unittest.main()
