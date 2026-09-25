#!/usr/bin/env python3
"""#1666 JSON-LD の «増えぶん» の測り方を縛る。

⚠️ ネットワークにも DB にも出ない。縛るのは次の 3 点である。

1. 交差表の 1 マスを決める `measure_html` が、本文と JSON-LD を **別々に**見ていること
2. «時刻の無い JSON-LD» を «取れた» に数えていないこと
3. 測るだけのスクリプトなので **書き込みが 1 つも無い**こと

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_measure_jsonld_opening_hours.py -v
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "measure_jsonld_opening_hours", HERE / "6_5_measure_jsonld_opening_hours.py"
)
assert _spec and _spec.loader
measure = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(measure)

_LD = '<script type="application/ld+json">{body}</script>'
_HOURS_TEXT = "当店の営業時間 11:30～14:30 定休日 月曜"


class MeasureHtmlTest(unittest.TestCase):
    def test_text_parses_and_jsonld_is_present(self) -> None:
        """既に取れている店。JSON-LD は要らない（交差表の A）。"""
        ld = _LD.format(body='{"openingHours":"Mo 11:30-14:30"}')
        html = f"<html><body>{_HOURS_TEXT}{ld}</body></html>"
        bucket, usable, written_only = measure.measure_html(html)
        self.assertEqual(bucket, "parsed")
        self.assertTrue(usable)
        self.assertFalse(written_only)

    def test_text_parses_without_jsonld(self) -> None:
        bucket, usable, written_only = measure.measure_html(f"<html><body>{_HOURS_TEXT}</body></html>")
        self.assertEqual(bucket, "parsed")
        self.assertFalse(usable)

    def test_jsonld_only_is_the_gain(self) -> None:
        """⚠️ これが «増えぶん»。本文からは読めないが JSON-LD には時刻がある（交差表の C）。

        `html_to_text` が `<script>` を捨てるので、本文側は営業時間を 1 文字も見ない。
        """
        html = (
            "<html><body>渋谷の和食店です。ご予約はお電話で。"
            + _LD.format(body='{"@type":"Restaurant","openingHours":"Mo-Fr 11:00-14:00"}')
            + "</body></html>"
        )
        bucket, usable, written_only = measure.measure_html(html)
        self.assertNotEqual(bucket, "parsed")
        self.assertTrue(usable)
        self.assertFalse(written_only)

    def test_neither(self) -> None:
        bucket, usable, written_only = measure.measure_html("<html><body>本日のおすすめ</body></html>")
        self.assertNotEqual(bucket, "parsed")
        self.assertFalse(usable)
        self.assertFalse(written_only)

    def test_jsonld_without_times_is_not_a_gain(self) -> None:
        """⚠️ «JSON-LD が書いてある» を増えぶんに数えると、この形が混ざる。"""
        html = "<html><body>和食店です。" + _LD.format(body='{"openingHours":"Mo-Su"}') + "</body></html>"
        bucket, usable, written_only = measure.measure_html(html)
        self.assertNotEqual(bucket, "parsed")
        self.assertFalse(usable)
        self.assertTrue(written_only)  # 参考値として別に数える


class SharesTheCrawlerPartsTest(unittest.TestCase):
    """⚠️ 写経していないこと。別の集合・別の判定を測ると数字の意味が無くなる。"""

    def test_uses_the_crawler_classifier_and_sql(self) -> None:
        import official_site_crawl

        self.assertIs(measure.classify_page_with_reason, official_site_crawl.classify_page_with_reason)
        self.assertIs(measure.fetch, official_site_crawl.fetch)
        self.assertIs(measure.pick_hop, official_site_crawl.pick_hop)
        self.assertIs(measure.CANDIDATE_SQL, measure._crawler.CANDIDATE_SQL)
        self.assertIs(measure.NEAR_CLAUSE, measure._crawler.NEAR_CLAUSE)

    def test_measure_html_does_not_reimplement_the_parser(self) -> None:
        source = inspect.getsource(measure.measure_html)
        self.assertIn("classify_page_with_reason", source)
        self.assertNotIn("re.compile", source)


class ReadOnlyTest(unittest.TestCase):
    SOURCE = (HERE / "6_5_measure_jsonld_opening_hours.py").read_text(encoding="utf-8")

    def test_no_writes_at_all(self) -> None:
        """⚠️ 測るだけ。1 行でも書いたら «測る前と後» が比べられなくなる。"""
        lowered = self.SOURCE.lower()
        for forbidden in ("insert into", "update ", "delete from", "commit()"):
            self.assertNotIn(forbidden, lowered, f"書き込みが混ざっている: {forbidden}")

    def test_public_schema_is_refused(self) -> None:
        self.assertIn('choices=["dev"]', self.SOURCE)
        self.assertIn("allow_public=False", self.SOURCE)

    def test_limit_is_required(self) -> None:
        """既定値があると 28 万サイトへ出て行く（6_3 と同じ理由）。"""
        self.assertIn('"--limit", type=int, required=True', self.SOURCE)

    def test_transaction_is_read_only(self) -> None:
        self.assertIn("default_transaction_read_only = on", self.SOURCE)


if __name__ == "__main__":
    unittest.main()
