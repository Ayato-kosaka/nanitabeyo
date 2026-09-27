"""#1947 «ハンドルすら無い店 1,580 軒» を在庫として読まないための天井。

2026-09-27 時点で、合格線に足りない 22 地点には «撃てる弾» が 0 件で、代わりに
«ハンドルすら無い店» が 1,580 軒あると `7_5` が出していた。ところが CC WAT（`4_9`）も
公式サイト巡回（#1777）も、**ページのホストが台帳の店の website と一致したときしか
店を決められない**。つまり 1,580 軒のうち «サイトのホストが台帳で一意に決まる» 店だけが
掘れる上限であり、それを並べずに 1,580 を «次の手» として読むのは
«判定している関数を読む前に在庫を報告する» のと同じ間違いである（4 度やった）。

そこで ⑦ として «handle 無し かつ サイトのホストが台帳で一意» を毎回数える。
判定は `common_sns.store_site_host_sql`（4_9 と共有する唯一の正）から取る。
"""

from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "7_5_measure_rank_coverage.py"
SCAN = HERE / "4_9_scan_cc_wat_instagram.py"

_spec = importlib.util.spec_from_file_location("m75site", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")

import common_sns  # noqa: E402

DS = "food-scroll.restaurant_recommendation"
DISH = "food-scroll.wikidata_food_graph"


def _sql() -> str:
    return m.build_sql(DS, DISH, sample_n=313, sample_run="restaurant-2026-08-23", radius_m=500)


class TheCeilingUsesTheSharedDictionary(unittest.TestCase):
    """4_9 と 7_5 が別々の «店のサイト» の判定を持たないこと。"""

    def test_the_cte_is_the_shared_sql_verbatim(self) -> None:
        shared = common_sns.store_site_host_sql(
            f"{DS}.restaurant_catalog", run_id_param="sample_catalog_run_id")
        self.assertIn(shared.strip(), _sql())

    def test_the_scanner_no_longer_keeps_its_own_copy(self) -> None:
        scan = SCAN.read_text(encoding="utf-8")
        self.assertIn("store_site_host_sql(", scan)
        self.assertNotIn("REGEXP_EXTRACT(website", scan,
                         "4_9 が website のホスト判定を自前で持ち直している")

    def test_the_measurement_does_not_transcribe_it_either(self) -> None:
        self.assertEqual(SRC.count("REGEXP_EXTRACT(website"), 0)

    def test_it_reads_the_sample_catalog_run_id(self) -> None:
        """地点の母数と同じカタログを引くこと（配信カタログの run_id ではない）。"""
        sql = _sql()
        cte = sql[sql.index("store_host AS ("):sql.index("pt_nohandle_site AS (")]
        self.assertIn("@sample_catalog_run_id", cte)
        self.assertNotIn("@catalog_run_id ", cte)


class TheCeilingCountsBothConditions(unittest.TestCase):
    """«handle が無い» と «サイトから辿れる» の両方を満たす店だけを数えること。"""

    def _cte(self) -> str:
        sql = _sql()
        i = sql.index("pt_nohandle_site AS (")
        return sql[i:sql.index("),", i)]

    def test_it_requires_the_store_to_have_no_handle(self) -> None:
        cte = self._cte()
        self.assertIn("LEFT JOIN handled h", cte)
        self.assertIn("WHERE h.gpid IS NULL", cte)

    def test_it_requires_the_host_to_resolve_to_that_store(self) -> None:
        self.assertIn("JOIN store_host sh ON sh.place_id = s.google_place_id", self._cte())

    def test_it_uses_the_shared_radius(self) -> None:
        self.assertIn("ST_DWithin(p.location, s.location, 500)", self._cte())

    def test_it_counts_distinct_stores(self) -> None:
        self.assertIn("COUNT(DISTINCT s.google_place_id)", self._cte())

    def test_the_ceiling_can_never_exceed_the_handle_less_count(self) -> None:
        """⑦ は ⑤ の部分集合である。両者の WHERE が同じ形であることで担保する。"""
        sql = _sql()
        base = sql[sql.index("pt_nohandle AS ("):sql.index("-- ⑦")]
        for frag in ("LEFT JOIN handled h ON h.gpid = s.google_place_id",
                     "WHERE h.gpid IS NULL"):
            self.assertIn(frag, base)
            self.assertIn(frag, self._cte())


class TheCeilingIsReported(unittest.TestCase):
    def test_the_column_reaches_python(self) -> None:
        self.assertIn('"no_handle_site_500m": int(r["no_handle_site_500m"]', SRC)

    def test_it_is_printed_right_after_the_handle_less_line(self) -> None:
        self.assertLess(SRC.index("巡回（#1777）で handle を掘れば届く"),
                        SRC.index("ここが CC WAT（4_9）と巡回（#1777）の天井である"))

    def test_zero_is_called_out_as_not_being_inventory(self) -> None:
        """⑦ が 0 のときに «あと 1,580 店» を次の手として読ませないこと。"""
        self.assertIn("在庫ではない", SRC)
        self.assertIn("if sum(ns) == 0 and sum(nh) > 0:", SRC)

    def test_it_says_the_ceiling_is_not_the_remainder(self) -> None:
        """2026-09-27、天井 204 店に対し «これから巡れる» は 0 店だった。

        天井を «残り» と読むと «まだ 204 店ある» になる。残りを出す道具の名前を
        同じ行に書いておく（自分の SQL で数えた数を在庫として報告しないため）。
        """
        self.assertIn("**残りではない**", SRC)
        self.assertIn("4_23_target_gap_point_stores.py --dry-run", SRC)

    def test_the_share_is_printed_and_never_divides_by_zero(self) -> None:
        self.assertIn('if sum(nh) else "-"', SRC)

    def test_the_reader_does_not_swallow_a_missing_key(self) -> None:
        self.assertNotIn('.get("no_handle_site_500m"', SRC)


class TheSharedSqlIsWellFormed(unittest.TestCase):
    def test_a_host_shared_by_two_stores_is_dropped(self) -> None:
        """チェーン公式を引き当てないこと（store_handle_dict_sql と同じ規律）。"""
        sql = common_sns.store_site_host_sql("t")
        self.assertIn("HAVING COUNT(DISTINCT pid) = 1", sql)

    def test_www_is_stripped_and_the_host_lowercased(self) -> None:
        sql = common_sns.store_site_host_sql("t")
        self.assertIn(r"r'^www\.'", sql)
        self.assertIn("LOWER(", sql)

    def test_the_run_id_parameter_is_configurable(self) -> None:
        self.assertIn("@crid", common_sns.store_site_host_sql("t"))
        self.assertIn("@x", common_sns.store_site_host_sql("t", run_id_param="x"))

    def test_the_inner_alias_is_not_place_id(self) -> None:
        """HAVING が出力エイリアスを指して «Aggregations of aggregations» で落ちる形を避ける。"""
        sql = common_sns.store_site_host_sql("t")
        self.assertIn("AS pid", sql)
        self.assertEqual(len(re.findall(r"\bAS place_id\b", sql)), 1)


if __name__ == "__main__":
    unittest.main()
