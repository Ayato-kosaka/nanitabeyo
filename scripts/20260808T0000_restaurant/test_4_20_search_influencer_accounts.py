"""#1273 検索結果から «アカウント» を採る規則を固定する。

守りたいのは 3 つ。

1. **投稿 URL・機能ページを handle として採らない**（`/p/` `/explore/` `/accounts/`）
2. **まとめ記事の本文の `@handle` も採る**（link より歩留まりが良いことがある）
3. **判定器の閾値と分岐点を勝手に動かさない**（動かすなら実測を貼り直すこと）

ネットワークにも BigQuery にも触らない。
"""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path

try:  # noqa: SIM105
    import google.cloud.bigquery  # noqa: F401
except Exception:  # noqa: BLE001 - 本物が無い環境でも純関数のテストは回す
    _bq = types.ModuleType("google.cloud.bigquery")
    for _n in ("Client", "ScalarQueryParameter", "ArrayQueryParameter", "QueryJobConfig",
               "LoadJobConfig", "ParquetOptions", "SchemaField", "Table"):
        setattr(_bq, _n, type(_n, (), {}))
    _bq.WriteDisposition = types.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")
    _bq.SourceFormat = types.SimpleNamespace(NEWLINE_DELIMITED_JSON="NDJSON", PARQUET="PARQUET")
    _google = sys.modules.setdefault("google", types.ModuleType("google"))
    _cloud = sys.modules.setdefault("google.cloud", types.ModuleType("google.cloud"))
    setattr(_google, "cloud", _cloud)
    setattr(_cloud, "bigquery", _bq)
    sys.modules["google.cloud.bigquery"] = _bq

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "search_influencer_accounts", HERE / "4_20_search_influencer_accounts.py")
finder = importlib.util.module_from_spec(_spec)
sys.modules["search_influencer_accounts"] = finder
_spec.loader.exec_module(finder)


def organic(*items) -> dict:
    return {"organic": list(items)}


class ExtractionTest(unittest.TestCase):
    def test_profile_link_is_taken(self):
        got = list(finder.handles_from(organic({"link": "https://www.instagram.com/fukuoka_gourmet/"})))
        self.assertEqual(got, [("fukuoka_gourmet", "profile_link", 1)])

    def test_post_and_feature_pages_are_not_handles(self):
        for link in ("https://www.instagram.com/p/ABC123/",
                     "https://www.instagram.com/reel/ABC123/",
                     "https://www.instagram.com/explore/tags/ramen/",
                     "https://www.instagram.com/accounts/login/"):
            self.assertEqual(list(finder.handles_from(organic({"link": link}))), [], link)

    def test_snippet_mentions_are_taken(self):
        got = list(finder.handles_from(organic(
            {"link": "https://example.com/matome", "snippet": "@sapporo.gourmet と @hakata_meshi"})))
        self.assertEqual([h for h, _, _ in got], ["sapporo.gourmet", "hakata_meshi"])

    def test_trailing_dot_is_trimmed(self):
        got = list(finder.handles_from(organic({"link": "https://example.com", "snippet": "@osaka_meshi."})))
        self.assertEqual(got[0][0], "osaka_meshi")


class QueryTest(unittest.TestCase):
    def test_all_47_prefectures_are_covered(self):
        self.assertEqual(len(finder.PREFECTURES), 47)
        self.assertEqual(len(finder.build_queries(None)),
                         47 * len(finder.QUERY_TEMPLATES))

    def test_truncation_still_spreads_over_prefectures(self):
        """打ち切っても全国に散ること（都道府県を内側に回す＝先頭 10 本が別々の県）。"""
        first10 = finder.build_queries(10)
        self.assertEqual(len({pref for pref, _ in first10}), 10)


class ThresholdTest(unittest.TestCase):
    def test_probe_thresholds_match_the_measurement(self):
        """docstring の実測表（25 投稿・異なり店 4 以上 → precision 95.1%）と一致させる。"""
        self.assertEqual(finder.PROBE_POSTS, 25)
        self.assertEqual(finder.PROBE_MIN_STORES, 4)

    def test_breakeven_matches_the_formula(self):
        """p·Y/(1+7p) > 0.542 を Y=17.1 で解いた値。式を変えたらここも直す。"""
        y, cost, baseline = 17.1, 7, finder.STORE_ACCOUNT_STORES_PER_CALL
        p = finder.BREAKEVEN_PASS_RATE
        self.assertAlmostEqual(p * y / (1 + cost * p), baseline, places=2)


if __name__ == "__main__":
    unittest.main()
