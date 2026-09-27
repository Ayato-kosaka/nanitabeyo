"""#1947 ハッシュタグ検索の «7 日で 30 タグ» を、道具の側で守る。

`ig_hashtag_search` は **1 IG ユーザにつき 7 日で 30 個の異なるタグ**しか引けない。
使い切ると 1 週間戻らない。合格線の未達地点は 21 件あるので、窓のほぼ全部を 1 度に
使う作戦になる。**数え間違えれば «追撃したいときに窓が無い» が 1 週間続く。**

このテストが固定するのは次の 4 つ。

1. 窓を消費するのは `ig_hashtag_search` **だけ**で、`top_media` / `recent_media` の
   ページングは消費しない（hashtag_id を持っている間は引き直さない）
2. 引いたタグは台帳（`sns_hashtag_search_attempt`）へ残し、**次の run はそれを読む**
3. 窓を越えるときは **引かずに見送り、そう言う**（黙って消費しない・回避策も出さない）
4. `post_id` は shortcode（他ルートと同じ自然キー）。IG の media id を使わない
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "4_25_collect_hashtag_posts.py"
SRC = SOURCE.read_text(encoding="utf-8")

_spec = importlib.util.spec_from_file_location("m425", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


class TheWindowIsTheScarceResource(unittest.TestCase):
    def test_the_documented_limits_are_the_ones_used(self) -> None:
        self.assertEqual(m.TAG_WINDOW_DAYS, 7)
        self.assertEqual(m.TAG_WINDOW_LIMIT, 30)

    def test_the_ledger_sql_only_counts_successful_searches(self) -> None:
        """not_found / error のタグも窓を消費するが、hashtag_id が無いので追撃できない。
        追撃できるタグの一覧としては ok だけを返すのが正しい。"""
        sql = m.window_sql("proj.ds.tbl")
        self.assertIn("outcome = 'ok'", sql)
        self.assertIn(f"INTERVAL {m.TAG_WINDOW_DAYS} DAY", sql)
        self.assertIn("GROUP BY tag", sql)

    def test_only_the_search_call_is_described_as_spending_the_window(self) -> None:
        i = SRC.index("def search_hashtag_id")
        self.assertIn("消費する", SRC[i:i + 400])

    def test_paging_says_it_does_not_spend_the_window(self) -> None:
        i = SRC.index("def media_pages")
        self.assertIn("消費しない", SRC[i:i + 700])

    def test_the_budget_guard_skips_instead_of_spending(self) -> None:
        i = SRC.index("if len(known) + spent >= TAG_WINDOW_LIMIT:")
        tail = SRC[i:i + 200]
        self.assertIn("skipped_budget.append(tag)", tail)
        self.assertIn("continue", tail)

    def test_it_says_out_loud_when_it_skipped_for_budget(self) -> None:
        self.assertIn("窓に当たったので", SRC)
        self.assertIn("回避策は実装しない", SRC)

    def test_a_spent_tag_is_recorded_even_when_the_tag_does_not_exist(self) -> None:
        """存在しないタグでも窓は 1 個減る。台帳に残らないと二重に払う。"""
        i = SRC.index("spent += 1")
        tail = SRC[i:i + 400]
        self.assertIn('"outcome": "ok" if hid else "not_found"', tail)


class TheRowsJoinTheOtherRoutes(unittest.TestCase):
    def setUp(self) -> None:
        self.shortcode = lambda u: (u.rstrip("/").rsplit("/", 1)[-1] or None) if "/p/" in u else None

    def test_post_id_is_the_shortcode_not_the_media_id(self) -> None:
        row = m.row_from_media(
            {"id": "17900000000000000", "permalink": "https://www.instagram.com/p/ABC123/",
             "caption": "所沢の焼き鳥"},
            tag="所沢グルメ", lat=35.79, lng=139.46, cat=None, run_id="r1",
            ig_shortcode_from_url=self.shortcode)
        self.assertEqual(row["post_id"], "ABC123")
        self.assertNotEqual(row["post_id"], "17900000000000000")

    def test_the_point_coordinates_ride_along_as_the_area(self) -> None:
        """ハッシュタグの投稿に位置情報は無い。地点の座標が resolve の唯一の手がかり。"""
        row = m.row_from_media(
            {"permalink": "https://www.instagram.com/p/ABC123/", "caption": "x"},
            tag="所沢グルメ", lat=35.79269, lng=139.46737, cat=None, run_id="r1",
            ig_shortcode_from_url=self.shortcode)
        self.assertEqual((row["discovery_area_lat"], row["discovery_area_lng"]),
                         (35.79269, 139.46737))

    def test_the_route_is_distinct_from_the_serper_one(self) -> None:
        """SERPER 経由は discovery_route='hashtag_search'。混ぜると効きを測れない。"""
        row = m.row_from_media(
            {"permalink": "https://www.instagram.com/p/ABC123/"},
            tag="t", lat=None, lng=None, cat=None, run_id="r1",
            ig_shortcode_from_url=self.shortcode)
        self.assertEqual(row["discovery_route"], "hashtag_api")
        self.assertEqual(row["discovery_method"], "ig_hashtag_top_media")

    def test_a_media_without_a_usable_permalink_is_dropped(self) -> None:
        self.assertIsNone(m.row_from_media(
            {"permalink": "https://www.instagram.com/explore/tags/x/"},
            tag="t", lat=None, lng=None, cat=None, run_id="r1",
            ig_shortcode_from_url=self.shortcode))

    def test_the_fetched_at_is_taken_per_row(self) -> None:
        """⚠️ run 開始時刻を焼き付けない（7942e1cb で 13 script を直した形）。"""
        i = SRC.index("def row_from_media")
        self.assertIn("utc_now().isoformat()", SRC[i:SRC.index("def parse_args")])


class TheGraphHelpersAreBorrowedNotCopied(unittest.TestCase):
    """一時エラーの再送・レート制限の判定・x-app-usage の記録は `4_2` が唯一の正。"""

    def test_it_imports_them_from_4_2(self) -> None:
        self.assertIn("4_2_collect_account_posts.py", SRC)
        self.assertIn("ig_mod._get(", SRC)

    def test_it_does_not_reimplement_the_http_layer(self) -> None:
        self.assertNotIn("urllib.request.urlopen", SRC)
        self.assertNotIn("def _get_once", SRC)


class TheTagFileIsReadForgivingly(unittest.TestCase):
    def test_it_reads_tag_lat_lng_category(self) -> None:
        p = HERE / "__tmp_tags.tsv"
        p.write_text("# コメント\n\n#所沢グルメ\t35.79269\t139.46737\tyakitori\n海浜幕張グルメ\t35.64899\t140.04306\n",
                     encoding="utf-8")
        try:
            got = m.read_tags(p, None)
        finally:
            p.unlink()
        self.assertEqual(got, [("所沢グルメ", 35.79269, 139.46737, "yakitori"),
                               ("海浜幕張グルメ", 35.64899, 140.04306, None)])

    def test_a_hashtag_line_is_not_mistaken_for_a_comment(self) -> None:
        """⚠️ «#» 始まりを一律コメントにすると、**タグ 0 件のまま «完了» する
        ラウンド**ができる。コメントは «# » か «##» のときだけ。"""
        self.assertTrue(m.is_comment("# これはコメント"))
        self.assertTrue(m.is_comment("## これもコメント"))
        self.assertTrue(m.is_comment("   "))
        self.assertFalse(m.is_comment("#所沢グルメ"))
        self.assertFalse(m.is_comment("所沢グルメ"))

    def test_an_empty_tag_list_is_refused_loudly(self) -> None:
        """仕事が無いのに «完了» しない。"""
        self.assertIn("タグが 1 つも読めませんでした", SRC)

    def test_the_leading_hash_is_stripped(self) -> None:
        """`ig_hashtag_search` の q に `#` を渡すと引けない。"""
        p = HERE / "__tmp_tags2.tsv"
        p.write_text("#盛岡グルメ\n", encoding="utf-8")
        try:
            self.assertEqual(m.read_tags(p, None)[0][0], "盛岡グルメ")
        finally:
            p.unlink()


if __name__ == "__main__":
    unittest.main()
