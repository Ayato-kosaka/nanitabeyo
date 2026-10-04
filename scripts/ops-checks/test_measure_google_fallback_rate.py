"""#1781 «発火 / 検索» の率で測ることを縛るテスト。BigQuery も認証も要らない。

守りたい形は 3 つ。どれも 2026-09-16 の誤報（`回/日` を依存の減少として報告した）から来ている。

1. **分母を外せないこと。** SQL が検索の入口イベントを数えていること
2. **回数が半分になっても、率が同じなら «依存は減っていない» と言うこと**
3. **`*_event_logs` ビューを使わないこと。** 1 日 18.4 GB かかる（生テーブルなら 77 MB）

実行:
    python3 -m unittest scripts/ops-checks/test_measure_google_fallback_rate.py -v
"""

from __future__ import annotations

import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import measure_google_fallback_rate as m  # noqa: E402


def day(n: int) -> dt.date:
    return dt.date(2026, 9, n)


class QueryShapeTest(unittest.TestCase):
    SQL = m.build_query("food-scroll", "nanitabeyo_logs_prod")

    def test_counts_the_denominator(self) -> None:
        """⚠️ 分母（検索の入口）を数えていること。これが無いと «交通量» を測ることになる。"""
        self.assertIn("@search_event", self.SQL)
        self.assertIn("searches", self.SQL)
        self.assertEqual(m.SEARCH_EVENT, "FindByCriteria")

    def test_reads_the_raw_table_with_a_timestamp_bound(self) -> None:
        """⚠️ `*_event_logs` ビューは `created_at` が計算列でパーティションが刈れない。"""
        self.assertIn("run_googleapis_com_stdout", self.SQL)
        self.assertIn("timestamp >= @since", self.SQL)
        self.assertIn("timestamp < @until", self.SQL)
        self.assertNotIn("_event_logs`", self.SQL)
        self.assertNotIn("created_at", self.SQL)

    def test_the_cost_ceiling_is_the_policy_threshold(self) -> None:
        self.assertEqual(m.ONE_GIB, 1024**3)


class RatioTest(unittest.TestCase):
    def test_zero_searches_is_not_zero_percent(self) -> None:
        self.assertIsNone(m.ratio(0, 0))
        self.assertIsNone(m.ratio(5, 0))

    def test_summarize_window(self) -> None:
        got = m.summarize([(day(1), 100, 70), (day(2), 300, 210)])
        self.assertEqual(got["days"], 2)
        self.assertEqual(got["searches"], 400)
        self.assertEqual(got["fallbacks"], 280)
        self.assertAlmostEqual(got["ratio"], 0.7)
        self.assertAlmostEqual(got["searches_per_day"], 200.0)


class CompareTest(unittest.TestCase):
    """⚠️ ここが 2026-09-16 の誤報に対する番人である。"""

    def test_halved_counts_with_the_same_ratio_is_volume_only(self) -> None:
        before = m.summarize([(day(1), 500, 365), (day(2), 500, 365)])
        after = m.summarize([(day(3), 250, 182), (day(4), 250, 183)])
        got = m.compare(before, after)
        self.assertEqual(got["verdict"], "volume_only")
        # 発火/日 はおよそ半分になっている。それでも «依存が減った» とは言わない
        self.assertLess(got["fallbacks_per_day_change"], -0.45)
        self.assertLess(abs(got["ratio_delta_pt"]), 1.0)

    def test_real_drop_is_reported_as_dependency_down(self) -> None:
        before = m.summarize([(day(1), 1000, 730)])
        after = m.summarize([(day(2), 1000, 300)])
        self.assertEqual(m.compare(before, after)["verdict"], "dependency_down")

    def test_real_rise_is_reported_as_dependency_up(self) -> None:
        before = m.summarize([(day(1), 1000, 300)])
        after = m.summarize([(day(2), 1000, 730)])
        self.assertEqual(m.compare(before, after)["verdict"], "dependency_up")

    def test_empty_window_is_unknown_not_flat(self) -> None:
        """⚠️ 片方が空の窓を «率は不動» と読まないこと。"""
        self.assertEqual(m.compare(m.summarize([]), m.summarize([(day(1), 10, 7)]))["verdict"], "unknown")

    def test_the_2026_09_16_numbers_land_on_volume_only(self) -> None:
        """実測そのもの（08-10〜09-04 と 09-11〜10-03）を入れて verdict を固定する。"""
        before = m.summarize([(day(1), 12455, 9106)])  # 24 日ぶんの合計を 1 行に畳んでいる
        after = m.summarize([(day(2), 5603, 4008)])
        got = m.compare(before, after)
        self.assertEqual(got["verdict"], "volume_only")
        self.assertAlmostEqual(got["ratio_delta_pt"], -1.6, places=1)


class ParseDayTest(unittest.TestCase):
    def test_accepts_date_and_rfc3339(self) -> None:
        self.assertEqual(m._parse_day("2026-09-11"), dt.datetime(2026, 9, 11, tzinfo=dt.timezone.utc))
        self.assertEqual(
            m._parse_day("2026-09-11T05:00:00Z"), dt.datetime(2026, 9, 11, 5, tzinfo=dt.timezone.utc)
        )


if __name__ == "__main__":
    unittest.main()
