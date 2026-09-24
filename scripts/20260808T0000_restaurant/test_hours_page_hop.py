#!/usr/bin/env python3
"""#1666 «1 ホップ辿る» のリンク選びを縛る。

⚠️ ここで縛るのは **どのリンクを選ぶか**だけである。ネットワークにも DB にも出ない。
"""

from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

hop = importlib.import_module("6_4_measure_hours_page_hop")


class PickHopTest(unittest.TestCase):
    BASE = "https://example.jp/index.html"

    def test_picks_the_opening_hours_link_first(self) -> None:
        html = """
        <a href="/about">当店について</a>
        <a href="/access">アクセス</a>
        <a href="/hours">営業時間</a>
        """
        url, label = hop.pick_hop(html, self.BASE)
        self.assertEqual(url, "https://example.jp/hours")
        self.assertEqual(label, "hours")

    def test_falls_back_to_store_then_access(self) -> None:
        url, label = hop.pick_hop('<a href="/shops">店舗一覧</a><a href="/ac">アクセス</a>', self.BASE)
        self.assertEqual(label, "store")
        self.assertEqual(url, "https://example.jp/shops")

    def test_stays_on_the_same_host(self) -> None:
        """⚠️ 外部（集約サイト・SNS）へ辿らない。«その店の営業時間» ではなくなる。"""
        html = '<a href="https://r.gnavi.co.jp/xxx/">営業時間</a>'
        url, _label = hop.pick_hop(html, self.BASE)
        self.assertIsNone(url)

    def test_ignores_non_http_and_self_links(self) -> None:
        for href in ("#hours", "mailto:a@example.jp", "tel:0312345678", "javascript:void(0)"):
            url, _l = hop.pick_hop(f'<a href="{href}">営業時間</a>', self.BASE)
            self.assertIsNone(url, href)
        # 自分自身へのリンクは辿らない（同じページを 2 回読むだけ）
        url, _l = hop.pick_hop('<a href="/index.html">営業時間</a>', self.BASE)
        self.assertIsNone(url)

    def test_matches_on_href_too(self) -> None:
        """リンク文字が画像だけのサイトがあるので href も見る。"""
        url, label = hop.pick_hop('<a href="/opening-hours/"><img src="a.png"></a>', self.BASE)
        self.assertEqual(url, "https://example.jp/opening-hours/")
        self.assertEqual(label, "en")

    def test_returns_none_when_nothing_looks_like_hours(self) -> None:
        url, label = hop.pick_hop('<a href="/cart">カートを見る</a>', self.BASE)
        self.assertIsNone(url)
        self.assertIsNone(label)

    def test_relative_links_resolve_against_the_page(self) -> None:
        url, _l = hop.pick_hop('<a href="hours.html">営業時間</a>', "https://example.jp/shop/top.html")
        self.assertEqual(url, "https://example.jp/shop/hours.html")


class SharedWithCrawlerTest(unittest.TestCase):
    """⚠️ 測る側とクローラが **同じ分類・同じ候補 SQL** を見ていること。"""

    def test_uses_the_same_classifier_and_candidate_sql(self) -> None:
        shared = importlib.import_module("official_site_crawl")
        crawler = importlib.import_module("6_3_crawl_official_site_hours")
        self.assertIs(hop.classify_page_with_reason, shared.classify_page_with_reason)
        self.assertIs(hop.fetch, shared.fetch)
        self.assertIs(hop.CANDIDATE_SQL, crawler.CANDIDATE_SQL)
        self.assertIs(hop.ORDER_BY_DISTANCE, crawler.ORDER_BY_DISTANCE)

    def test_writes_nothing(self) -> None:
        """⚠️ 測るだけ。INSERT / UPDATE / DELETE を 1 つも書かない。"""
        source = (HERE / "6_4_measure_hours_page_hop.py").read_text(encoding="utf-8")
        for verb in ("INSERT ", "UPDATE ", "DELETE "):
            self.assertNotIn(verb, source.upper().replace("DELETE:", ""), verb)
        self.assertIn("default_transaction_read_only", source)


if __name__ == "__main__":
    unittest.main()
