#!/usr/bin/env python3
"""#1666 JSON-LD からの営業時間の «取り出し» を縛る。

⚠️ ここで縛るのは **HTML から値を取り出すところ**だけである。ネットワークにも DB にも出ない。
曜日 × 時刻への展開は `jp_site_opening_hours` の担当なので、ここでは扱わない。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from jsonld_opening_hours import (  # noqa: E402
    entries_with_times,
    extract_opening_hours_entries,
    has_opening_hours,
    has_opening_hours_with_times,
    iter_jsonld_blocks,
)


def _script(body: str, attrs: str = 'type="application/ld+json"') -> str:
    return f"<html><head><script {attrs}>{body}</script></head><body>店</body></html>"


class ExtractTest(unittest.TestCase):
    def test_plain_opening_hours_string(self) -> None:
        html = _script('{"@type":"Restaurant","openingHours":"Mo-Fr 11:00-14:00"}')
        self.assertEqual(extract_opening_hours_entries(html), ["Mo-Fr 11:00-14:00"])
        self.assertTrue(has_opening_hours_with_times(html))

    def test_opening_hours_specification_under_graph(self) -> None:
        """⚠️ `@graph` を降りられること。降りないと実サイトの半分を取りこぼす。"""
        html = _script(
            '{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},'
            '{"@type":"Restaurant","openingHoursSpecification":'
            '[{"dayOfWeek":["Monday"],"opens":"11:00","closes":"14:00"}]}]}'
        )
        self.assertTrue(has_opening_hours(html))
        self.assertTrue(has_opening_hours_with_times(html))

    def test_array_at_the_top_level(self) -> None:
        html = _script('[{"@type":"Organization"},{"@type":"Restaurant","openingHours":["Sa 10:00-15:00"]}]')
        self.assertTrue(has_opening_hours_with_times(html))

    def test_attribute_order_does_not_matter(self) -> None:
        html = _script(
            '{"openingHours":"Mo 09:00-18:00"}',
            attrs='id="schema" type=\'application/ld+json\' data-x="1"',
        )
        self.assertTrue(has_opening_hours_with_times(html))

    def test_other_script_types_are_ignored(self) -> None:
        html = _script('{"openingHours":"Mo 09:00-18:00"}', attrs='type="application/json"')
        self.assertFalse(has_opening_hours(html))

    def test_html_comment_wrapper(self) -> None:
        html = _script('<!-- {"openingHours":"Su 08:00-17:00"} -->')
        self.assertTrue(has_opening_hours_with_times(html))

    def test_broken_block_does_not_hide_a_valid_one(self) -> None:
        """⚠️ 1 つ壊れているせいでページ全体を諦めると、«壊れていないサイトの割合» を測ることになる。"""
        html = (
            _script('{"openingHours": "Mo 11:00-14:00",}')  # 末尾カンマ
            + _script('{"openingHours":"Tu 11:00-14:00"}')
        )
        self.assertEqual(list(iter_jsonld_blocks(html)), [{"openingHours": "Tu 11:00-14:00"}])
        self.assertTrue(has_opening_hours_with_times(html))

    def test_plain_html_has_nothing(self) -> None:
        self.assertFalse(has_opening_hours("<html><body>営業時間 11:00-14:00</body></html>"))


class UsableTimesTest(unittest.TestCase):
    """«書いてある» と «営業時間として使える» を分ける。"""

    def test_days_without_any_time_is_not_usable(self) -> None:
        html = _script('{"openingHours":"Mo-Su"}')
        self.assertTrue(has_opening_hours(html))
        self.assertFalse(has_opening_hours_with_times(html))

    def test_one_sided_time_is_not_usable(self) -> None:
        """«18:00 から» しか書いていない形。閉店時刻が無いので区間にならない。"""
        html = _script('{"openingHours":"Mo 18:00-"}')
        self.assertFalse(has_opening_hours_with_times(html))

    def test_spec_without_opens_closes_is_not_usable(self) -> None:
        html = _script('{"openingHoursSpecification":[{"dayOfWeek":"Monday"}]}')
        self.assertTrue(has_opening_hours(html))
        self.assertFalse(has_opening_hours_with_times(html))

    def test_unrelated_times_in_a_spec_are_not_counted(self) -> None:
        """⚠️ dict の値を再帰で降りると `validFrom` を «営業時間» として数える。"""
        html = _script(
            '{"openingHoursSpecification":[{"dayOfWeek":"Monday",'
            '"validFrom":"2026-01-01T09:00","validThrough":"2026-12-31T18:00"}]}'
        )
        self.assertFalse(has_opening_hours_with_times(html))

    def test_iso_seconds_and_offsets_are_accepted(self) -> None:
        html = _script('{"openingHoursSpecification":[{"opens":"11:00:00","closes":"14:00+09:00"}]}')
        self.assertTrue(has_opening_hours_with_times(html))

    def test_usable_entries_are_returned_not_just_counted(self) -> None:
        html = _script('[{"openingHours":"Mo-Su"},{"openingHours":"Tu 11:00-14:00"}]')
        self.assertEqual(entries_with_times(html), ["Tu 11:00-14:00"])


if __name__ == "__main__":
    unittest.main()
