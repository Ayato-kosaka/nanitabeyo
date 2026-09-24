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


class ItAlsoSaysWhatCrawlingCannotReachTest(unittest.TestCase):
    """«巡回対象 N 店» だけを出すと «まだ余地がある» に読める。

    実際は一巡した時点でその N は 0 になり、**公式サイトを持たない店だけが残る**。
    残りの大きさを併記しないと «次にどの経路が要るか» を判断できない
    （2026-09-23: 1 周目 1,239 店 → 2 周目 589 店 と減り、打率も 20.5% → 10.9% に落ちた）。
    """

    def test_it_counts_stores_without_a_website(self):
        sql = m.build_unreachable_sql("food-scroll.restaurant_recommendation", radius_m=500)
        self.assertIn("without_website", sql)
        self.assertIn("with_website", sql)
        self.assertIn("no_handle_total", sql)

    def test_it_only_counts_stores_we_have_no_handle_for(self):
        sql = m.build_unreachable_sql("d", radius_m=500)
        self.assertIn("WHERE h.gpid IS NULL", sql)

    def test_the_report_warns_that_crawling_cannot_reach_them(self):
        self.assertIn("巡回が届かない", SRC)


class AlreadyCrawledStoresAreNotTargetedAgain(unittest.TestCase):
    """#1947 一度巡って handle が出なかった店を、次の周回でまた «対象» に数えない。

    2026-09-22〜23 の 3 周で巡回の打率が 36.8% → 20.5% → **10.9%** と半減し続けた。
    相手が減ったからではなく、**失敗した店を毎回また分母へ入れていた**（除いていたのは
    «handle を知っている店» だけだった）。«巡回対象 N 店» が «これから掘れる N 店» を
    意味しなくなり、周回ごとの見積もりが外れ続けた。

    ⚠️ 値ではなく **パターン**を固定する。
    """

    DS = "food-scroll.restaurant_recommendation"

    def test_terminal_statuses_are_excluded(self) -> None:
        sql = m.build_sql(self.DS, radius_m=500)
        self.assertIn("sns_store_site_ig", sql,
                      "巡回済みの台帳を見ていない。失敗した店をまた対象に数えてしまう")
        self.assertIn("@terminal", sql)

    def test_transient_failures_stay_retryable(self) -> None:
        """`fetch_failed` は **相手側の一時的な失敗**。恒久的な失敗として切り捨てない。"""
        self.assertNotIn("fetch_failed", m.TERMINAL_CRAWL_STATUS)
        for st in ("no_handle", "no_website", "robots_blocked", "website_is_ig", "ok"):
            self.assertIn(st, m.TERMINAL_CRAWL_STATUS)

    def test_a_store_that_already_gave_its_handles_is_terminal(self) -> None:
        """`ok` も終端。**4_1 が登録しなかった店が `handled` から漏れる**ので、
        ここで止めないと «同じ handle を採り直すだけ» の巡回が毎周混ざる
        （gapcrawl2 の 56 店がそれで、新規はゼロだった）。"""
        self.assertIn("ok", m.TERMINAL_CRAWL_STATUS)

    def test_the_exclusion_is_defined_once(self) -> None:
        """同じ判定を 2 箇所に書かない（片方だけ直った状態を作らない）。"""
        import ast
        src = SRC
        self.assertEqual(src.count("sns_store_site_ig"), 0,
                         "テーブル名を直書きしている。common_sns の定数を使う")
        # 巡回済み台帳を読むのは `_crawled_cte` の中だけ。
        # ⚠️ «テーブル名が 1 回しか出ない» で縛らない。同じ関数の中で 2 回読むのは重複ではなく、
        #    そう縛ると «定義を 1 箇所に集める» のではなく «SQL を捻じ曲げる» 方向へ誘導される。
        tree = ast.parse(src)
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "_crawled_cte")
        inside = ast.get_source_segment(src, fn) or ""
        self.assertEqual(src.count("TABLE_STORE_SITE_IG}`"),
                         inside.count("TABLE_STORE_SITE_IG}`"),
                         "巡回済み台帳を `_crawled_cte` の外でも読んでいる。1 箇所に集める")
        self.assertGreaterEqual(inside.count("TABLE_STORE_SITE_IG}`"), 1)
        self.assertEqual(src.count("_crawled_cte(ds)"), 2,
                         "build_sql と build_unreachable_sql の両方が同じ定義を使うこと")

    def test_dead_sites_are_terminal_but_transient_server_errors_are_not(self) -> None:
        """`fetch_failed` を «全部一時的» とも «全部恒久的» とも扱わない。

        gapcrawl1 → gapcrawl2 の転換率で決めた: DNS 不存在 66 店・404 34 店・403 22 店は
        **1 件も** handle が出ず、429 / 5xx / 切断の 14 店は **6 件（43%）** 出た。
        """
        import re as _re
        rx = _re.compile(m.DEAD_SITE_ERROR_RE)
        for dead in ("URLError: <urlopen error [Errno -2] Name or service not known>",
                     "URLError: <urlopen error [Errno -5] No address associated with hostname>",
                     "URLError: <urlopen error [Errno -3] Temporary failure in name resolution>",
                     "HTTPError: HTTP Error 404: Not Found",
                     "HTTPError: HTTP Error 403: Forbidden"):
            self.assertTrue(rx.search(dead), f"終端にできていない: {dead}")
        for alive in ("HTTPError: HTTP Error 429: Too Many Requests",
                      "HTTPError: HTTP Error 500: Internal Server Error",
                      "HTTPError: HTTP Error 502: Bad Gateway",
                      "RemoteDisconnected: Remote end closed connection without response",
                      "URLError: <urlopen error [SSL: SSLV3_ALERT_HANDSHAKE_FAILURE] ...>",
                      "URLError: <urlopen error timed out>"):
            self.assertIsNone(rx.search(alive),
                              f"一時的な失敗を恒久的として切り捨てている（#1815）: {alive}")

    def test_dead_site_rule_is_applied_in_the_shared_cte(self) -> None:
        for sql in (m.build_sql(self.DS, radius_m=500),
                    m.build_unreachable_sql(self.DS, radius_m=500)):
            self.assertIn("@dead_site_re", sql)

    def test_repeated_fetch_failures_stop_being_retried(self) -> None:
        """«一時的» は «何度でも撃ち直してよい» ではない。

        2026-09-24、一時的な失敗しか無い 25 店を巡り直して **0 件**、その前の 130 店も
        **0 件**（合計 155 店・handle 0）。2 度目からは «そういうサイト» と見なす。
        """
        self.assertEqual(m.MAX_FETCH_ATTEMPTS, 2)
        for sql in (m.build_sql(self.DS, radius_m=500),
                    m.build_unreachable_sql(self.DS, radius_m=500)):
            self.assertIn("@max_attempts", sql)
            self.assertIn("COUNT(DISTINCT run_id)", sql)

    def test_report_splits_crawlable_from_already_crawled(self) -> None:
        """«まだ N 店ある» と誤読させない。これから巡れる分と巡り終えた分を分けて出す。"""
        sql = m.build_unreachable_sql(self.DS, radius_m=500)
        self.assertIn("crawlable_now", sql)
        self.assertIn("already_crawled", sql)


class TheCrawlExclusionIsOptional(unittest.TestCase):
    """#1947 巡回用の除外を «検索» 経路へ引き継がせない。

    除外しているのは «その店のサイトに Instagram が載っていなかった» という事実で、
    «その店に Instagram が無い» ではない。検索（4_24）はサイトを経由しないので、
    そのまま使うと 457 店を理由なく捨てる。
    ⚠️ 一方で «handle を既に知っている» の除外は、どちらの経路でも同じである。
    """

    DS = "food-scroll.restaurant_recommendation"

    def test_search_path_keeps_crawled_stores(self) -> None:
        sql = m.build_sql(self.DS, radius_m=500, require_website=False, exclude_crawled=False)
        self.assertNotIn("sns_store_site_ig", sql)
        self.assertNotIn("@terminal", sql)

    def test_the_empty_side_is_typed(self) -> None:
        """裸の `NULL` は INT64 になり、STRING の place_id と比べた瞬間 400 で落ちる
        （2026-09-24 に run 1152 で踏んだ）。"""
        sql = m.build_sql(self.DS, radius_m=500, require_website=False, exclude_crawled=False)
        # ⚠️ コメント行を外してから見る。**コメントは «踏んだ間違い» を名前で残している**ので、
        #    生のテキストで探すとコメント自体に当たって偽陽性になる（ここで実際に踏んだ）。
        body = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
        self.assertIn("UNNEST(CAST([] AS ARRAY<STRING>))", body)
        self.assertNotIn("SELECT NULL AS gpid", body)
        self.assertNotIn("AS gpid WHERE FALSE", body)

    def test_both_paths_still_drop_stores_whose_handle_is_known(self) -> None:
        for sql in (m.build_sql(self.DS, radius_m=500),
                    m.build_sql(self.DS, radius_m=500, require_website=False,
                                exclude_crawled=False)):
            self.assertIn("handled", sql)
            self.assertIn("WHERE h.gpid IS NULL", sql)
