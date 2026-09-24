"""#1947 合格線の地点の店を **店名で検索して** Instagram を探す経路（4_24）。

2026-09-24、積み残し 20 万投稿を全部 resolve して配信店を +1,769 しても **合格線は 1 地点も
動かなかった**。KPI は地点ごとの閾値関数なので «どこかの店» をいくら増やしても効かない。
残り 21 地点の 500m 圏の handle 未知 1,432 店のうち **943 店は公式サイトが無く、巡回では
原理的に届かない**。検索だけが届く。

このテストは値ではなく **パターン**を固定する:
  1. 対象の «handle を知らない» の定義は `4_23` と同じものを使う（2 箇所に書かない）
  2. **サイトの有無で絞らない**（絞ると 943 店を最初から捨てる）
  3. `--report-only` は SERPER を 1 回も呼ばない（承認前に判断材料を作るため）
  4. 見つけた handle は **探していた店の place_id に紐づける**（ただの handle に戻さない）
  5. influencer 探索の候補表と混ぜない（`region` の意味が違う）
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "4_24_search_store_handles.py"

_spec = importlib.util.spec_from_file_location("m424", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")


class TheQueryIsOnePerStore(unittest.TestCase):
    def test_query_is_name_plus_area(self) -> None:
        self.assertEqual(m.build_query("鮨 さいとう", "東京都港区六本木1-4-5 アークヒルズ"),
                         "鮨 さいとう 東京都港区六本木1-4 instagram")

    def test_a_missing_address_still_makes_a_query(self) -> None:
        self.assertEqual(m.build_query("町中華 大将", None), "町中華 大将 instagram")

    def test_the_address_is_cut_short(self) -> None:
        """番地・建物名まで入れると 0 件になるので、住所は頭だけ使う。"""
        q = m.build_query("店", "東京都千代田区丸の内1-9-1 グラントウキョウノースタワー 12F")
        self.assertNotIn("グラントウキョウ", q)


class ItDoesNotThrowAwayStoresWithoutAWebsite(unittest.TestCase):
    def test_it_asks_4_23_for_stores_without_a_website(self) -> None:
        self.assertIn("require_website=False", SRC,
                      "サイトのある店だけに絞っている。943 店（65%）を最初から捨てることになる")

    def test_it_does_not_inherit_the_crawl_only_exclusion(self) -> None:
        """«サイトを巡ったが handle が出なかった» は «その店に Instagram が無い» ではない。

        検索はサイトを経由しないので、巡回用の除外をそのまま使うと **457 店を理由なく
        捨てる**（2026-09-24 の --report-only で 1,432 → 975 に減っていた）。
        """
        self.assertIn("exclude_crawled=False", SRC,
                      "巡回用の除外を引き継いでいる。検索では関係が無い事実で絞っている")

    def test_the_handle_unknown_rule_is_not_copied(self) -> None:
        """«handle を知らない» の定義は `4_23` のものを呼ぶ（写経しない）。"""
        self.assertIn("m423.build_sql(", SRC)
        self.assertNotIn("sns_source_account", SRC,
                         "店の除外規則を自前で書いている。4_23 の定義を使うこと")


class ReportOnlyCostsNothing(unittest.TestCase):
    def test_report_only_returns_before_any_search(self) -> None:
        """⚠️ 承認前に判断材料を作れること。ここで API を呼ぶと «無断でクレジットを使う»。"""
        tree = ast.parse(SRC)
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "main")
        body = ast.get_source_segment(SRC, fn) or ""
        before, _, after = body.partition("args.report_only")
        self.assertNotIn("serper_search", before,
                         "--report-only の判定より前に検索している")
        self.assertIn("serper_search", after)

    def test_it_stops_when_there_is_no_key(self) -> None:
        self.assertIn("SERPER_API_KEY", SRC)


class FoundHandlesStayBoundToTheStore(unittest.TestCase):
    def test_place_id_is_kept(self) -> None:
        rows = m.candidate_rows(
            [("ChIJabc", "鮨 さいとう 東京都港区 instagram", "sushi_saito", "profile_link", 1)],
            run_id="r", now_iso="2026-09-24T00:00:00+00:00")
        self.assertEqual(rows[0]["region"], "ChIJabc",
                         "店の place_id を落としている。合格線の地点へ撃ち返せなくなる")
        self.assertEqual(rows[0]["handle"], "sushi_saito")

    def test_empty_handles_are_dropped(self) -> None:
        self.assertEqual(m.candidate_rows([("ChIJabc", "q", "", "profile_link", 1)],
                                          run_id="r", now_iso="t"), [])

    def test_it_uses_its_own_table(self) -> None:
        """influencer 探索の表と混ぜない（`region` の意味が違う）。"""
        self.assertEqual(m.TABLE_STORE_QUERY_CANDIDATE, "sns_store_query_candidate")
        self.assertIn("ensure_table(pipeline, TABLE_STORE_QUERY_CANDIDATE)", SRC)


if __name__ == "__main__":
    unittest.main()
