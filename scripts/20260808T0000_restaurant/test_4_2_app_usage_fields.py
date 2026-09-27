"""#1791 / #1947 «どの資源が天井に当たっているか» を max に畳んで捨てない。

2026-09-27、同じ引数の収集ラウンドで実効レートが **159.8 → 307.7 アカウント/時（1.93 倍）**
に上がった。コードは変わっておらず（`pace_for_app_usage` の段も 2026-09-22 から同じ）、
1 アカウントあたりの投稿数も 35.4〜35.6 で一定。にもかかわらず **コール総数が 45% 増えて
使用率の最大が 93% → 85% へ下がった**。相手側の枠が緩んだと読めるが、
`x-app-usage` の 3 つの値（`call_count` / `total_time` / `total_cputime`）を
`max()` で 1 つに畳んでいたので、**どの資源が緩んだのかを言えなかった**。

«Meta アプリを N 個にすると N 倍になるか»（#1791）は、当たっている資源がアプリ単位か
どうかで答えが変わる。だから 3 つとも残し、天井に当たっているものを名指しする。
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "4_2_collect_account_posts.py"

_spec = importlib.util.spec_from_file_location("m42usage", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def _h(**fields: int) -> dict:
    return {"x-app-usage": json.dumps(fields)}


class TheThreeUsagesAreKept(unittest.TestCase):
    def setUp(self) -> None:
        m._APP_USAGE.update(
            pct=0, peak=0, tier=None, waited_s=0.0,
            fields=dict.fromkeys(m._USAGE_FIELDS, 0),
            peak_fields=dict.fromkeys(m._USAGE_FIELDS, 0))

    def test_each_field_is_reported_separately(self) -> None:
        m._note_usage(_h(call_count=12, total_time=85, total_cputime=3))
        self.assertEqual("呼数 12% / 時間 85% / CPU 3%", m.usage_fields_text())

    def test_the_binding_resource_is_named(self) -> None:
        m._note_usage(_h(call_count=12, total_time=85, total_cputime=3))
        self.assertEqual("total_time", m.binding_usage_field())
        m._note_usage(_h(call_count=90, total_time=40, total_cputime=1))
        self.assertEqual("call_count", m.binding_usage_field())

    def test_the_peak_is_per_field_not_just_the_max(self) -> None:
        """畳んだ最大だけ覚えると «時間は 85% まで行った» が消える。"""
        m._note_usage(_h(call_count=10, total_time=85, total_cputime=2))
        m._note_usage(_h(call_count=90, total_time=40, total_cputime=1))
        self.assertEqual("呼数 90% / 時間 85% / CPU 2%", m.usage_fields_text())

    def test_the_latest_reading_is_kept_apart_from_the_peak(self) -> None:
        m._note_usage(_h(call_count=90, total_time=85, total_cputime=9))
        m._note_usage(_h(call_count=5, total_time=4, total_cputime=1))
        self.assertEqual("呼数 5% / 時間 4% / CPU 1%", m.usage_fields_text("fields"))
        self.assertEqual("呼数 90% / 時間 85% / CPU 9%", m.usage_fields_text())

    def test_the_pacing_still_reads_the_highest_of_the_three(self) -> None:
        """減速は «どれか 1 つでも上限に近い» で掛けること（緩い方を見ると 100% に当てる）。"""
        m._note_usage(_h(call_count=1, total_time=96, total_cputime=1))
        self.assertEqual(96, m._APP_USAGE["pct"])

    def test_a_missing_field_counts_as_zero(self) -> None:
        m._note_usage({"x-app-usage": json.dumps({"call_count": 7})})
        self.assertEqual("呼数 7% / 時間 0% / CPU 0%", m.usage_fields_text())

    def test_a_broken_header_does_not_raise_or_clobber(self) -> None:
        m._note_usage(_h(call_count=50, total_time=1, total_cputime=1))
        m._note_usage({"x-app-usage": "not json"})
        m._note_usage({})
        self.assertEqual("呼数 50% / 時間 1% / CPU 1%", m.usage_fields_text())

    def test_the_header_name_is_matched_case_insensitively(self) -> None:
        m._note_usage({"X-App-Usage": json.dumps({"total_time": 33})})
        self.assertEqual(33, m._APP_USAGE["pct"])


class ThePacingTiersAreUnchanged(unittest.TestCase):
    """段を動かすと «1.93 倍» の比較ができなくなる。2026-09-22 の実測と同じ段を保つ。"""

    def test_the_four_tiers_are_the_measured_ones(self) -> None:
        src = SOURCE.read_text(encoding="utf-8")
        self.assertIn("delay = 60 if pct >= 95 else 20 if pct >= 85"
                      " else 8 if pct >= 75 else 2 if pct >= 60 else 0", src)


class TheRunEndLinePrintsTheBreakdown(unittest.TestCase):
    def test_it_names_the_binding_resource(self) -> None:
        src = SOURCE.read_text(encoding="utf-8")
        self.assertIn("天井に当たっているのは %s", src)
        self.assertIn("binding_usage_field()", src)

    def test_it_prints_both_the_peak_and_the_final_breakdown(self) -> None:
        src = SOURCE.read_text(encoding="utf-8")
        self.assertIn("usage_fields_text()", src)
        self.assertIn('usage_fields_text("fields")', src)


if __name__ == "__main__":
    unittest.main()
