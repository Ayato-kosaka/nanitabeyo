"""#1273 柱1 本番化のロジックを、ネットワーク・BigQuery なしで固定する。

検証対象は 3 つの純関数:
  - pillar1_site_extract.store_specific_handles … 1 店の店固有フィルタ（blocklist・集約裏取り）
  - 4_4.build_store_site_rows              … fetch 結果 → sns_store_site_ig 行（到達性も記録）
  - 4_1.store_branch_rows_from_crawl       … グローバルチェーン除去 → store_branch 行

エビデンスは «実際に fetch 済み» の 322 店標本（out/pillar1_site_extract.json）を入力に使う。
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

HERE = Path(__file__).resolve().parent
POC = HERE / "1273_instagram_seed_poc"
SAMPLE = POC / "out" / "pillar1_site_extract.json"
sys.path.insert(0, str(POC))

import pillar1_site_extract as p1  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod_4_4 = _load(HERE / "4_4_crawl_official_site_igs.py", "crawl_official_site_igs")
mod_4_1 = _load(HERE / "4_1_discover_sns_accounts.py", "discover_sns_accounts")


class StoreSpecificFilterTest(unittest.TestCase):
    def test_platform_handle_is_dropped(self) -> None:
        rec = {"host": "example.com", "name": "Foo", "aggregator_host": False,
               "new_handles": {"tabelog": ["ig_url"], "foo_kitchen": ["ig_url"]}}
        out = p1.store_specific_handles(rec)
        self.assertNotIn("tabelog", out)
        self.assertIn("foo_kitchen", out)

    def test_aggregator_host_requires_name_corroboration(self) -> None:
        # website が集約メディア（tabelog）で、店名裏取りの無い generic handle は落ちる
        rec = {"host": "tabelog.com", "name": "とんかつ庄助", "aggregator_host": True,
               "new_handles": {"gourmet_tokyo": ["ig_url"]}}
        self.assertEqual({}, p1.store_specific_handles(rec))
        # 店名（英字）裏取りがあれば残る
        rec2 = {"host": "tabelog.com", "name": "Shosuke", "aggregator_host": True,
                "new_handles": {"shosuke_ten": ["ig_url"]}}
        self.assertIn("shosuke_ten", p1.store_specific_handles(rec2))

    def test_own_site_handle_kept_and_corroboration_flagged(self) -> None:
        rec = {"host": "koukakurou.jp", "name": "黄鶴楼", "aggregator_host": False,
               "new_handles": {"koukakurou": ["ig_url", "jsonld_sameas"]}}
        out = p1.store_specific_handles(rec)
        self.assertIn("koukakurou", out)
        self.assertTrue(out["koukakurou"]["corroborated"])  # domain トークン一致
        self.assertEqual(["ig_url", "jsonld_sameas"], out["koukakurou"]["tags"])


class BuildStoreSiteRowsTest(unittest.TestCase):
    def test_reachability_rows_recorded_for_failures(self) -> None:
        recs = [
            {"id": "P_FAIL", "name": "x", "website": "http://dead.example",
             "host": "dead.example", "status": "fetch_failed", "error": "URLError",
             "new_handles": {}},
            {"id": "P_ROBOTS", "name": "y", "website": "http://x.example",
             "host": "x.example", "status": "robots_blocked", "new_handles": {}},
            {"id": "P_OK_NOHANDLE", "name": "z", "website": "http://z.example",
             "host": "z.example", "status": "ok", "new_handles": {}},
        ]
        rows = mod_4_4.build_store_site_rows(recs, "run-x", "2026-08-31T00:00:00+00:00")
        by_pid = {r["google_place_id"]: r for r in rows}
        self.assertEqual("fetch_failed", by_pid["P_FAIL"]["status"])
        self.assertEqual("URLError", by_pid["P_FAIL"]["error"])
        self.assertEqual("robots_blocked", by_pid["P_ROBOTS"]["status"])
        self.assertEqual("no_handle", by_pid["P_OK_NOHANDLE"]["status"])
        for r in rows:  # 失敗行は handle=NULL
            self.assertIsNone(r["handle"])

    def test_one_row_per_store_specific_handle(self) -> None:
        recs = [{"id": "P1", "name": "Koukakurou", "website": "http://koukakurou.jp",
                 "host": "koukakurou.jp", "status": "ok",
                 "new_handles": {"koukakurou": ["ig_url"], "tabelog": ["ig_url"]}}]
        rows = mod_4_4.build_store_site_rows(recs, "run-x", "2026-08-31T00:00:00+00:00")
        handles = sorted(r["handle"] for r in rows)
        self.assertEqual(["koukakurou"], handles)  # tabelog は blocklist で落ちる
        self.assertEqual("ok", rows[0]["status"])
        self.assertEqual("run-x", rows[0]["run_id"])

    def test_on_real_322_sample(self) -> None:
        with open(SAMPLE, encoding="utf-8") as _f:
            recs = json.load(_f)
        rows = mod_4_4.build_store_site_rows(recs, "run-322", "2026-08-31T00:00:00+00:00")
        summ = mod_4_4.summarize_rows(rows)
        # 実標本で «店固有 handle が取れる» ことを固定（回帰時に気づけるよう下限で縛る）
        self.assertGreaterEqual(summ["stores_with_store_specific_handle"], 40)
        self.assertGreaterEqual(summ["distinct_handles"], 40)
        # 到達不能/robots が handle=NULL 行として残っていること（reachability の観測）
        self.assertGreaterEqual(summ["status_counts"].get("fetch_failed", 0), 50)
        self.assertGreaterEqual(summ["status_counts"].get("robots_blocked", 0), 1)
        # 全 322 店が最低 1 行は持つ（観測の取りこぼしなし）
        self.assertEqual(len(recs), summ["stores"])
        self._last_summary = summ


class GlobalChainRemovalTest(unittest.TestCase):
    def test_handle_on_multiple_places_is_dropped(self) -> None:
        pairs = [
            ("PLACE_A", "chain_official"),   # 2 店に付く → チェーン
            ("PLACE_B", "chain_official"),
            ("PLACE_C", "cafe_solo"),        # 1 店だけ → 店固有
        ]
        import datetime
        now = datetime.datetime(2026, 8, 31, tzinfo=datetime.timezone.utc)
        rows = list(mod_4_1.store_branch_rows_from_crawl(pairs, "run-x", now))
        handles = {r["handle"] for r in rows}
        self.assertEqual({"cafe_solo"}, handles)
        r = rows[0]
        self.assertEqual("store_branch", r["account_type"])
        self.assertEqual("official_site_crawl", r["discovery_method"])
        self.assertEqual("PLACE_C", r["discovery_seed_place_id"])
        self.assertEqual("instagram", r["provider"])

    def test_end_to_end_322_sample_to_store_branch(self) -> None:
        with open(SAMPLE, encoding="utf-8") as _f:
            recs = json.load(_f)
        rows = mod_4_4.build_store_site_rows(recs, "run-322", "2026-08-31T00:00:00+00:00")
        pairs = [(r["google_place_id"], r["handle"]) for r in rows if r["handle"]]
        import datetime
        now = datetime.datetime(2026, 8, 31, tzinfo=datetime.timezone.utc)
        branch = list(mod_4_1.store_branch_rows_from_crawl(pairs, "run-322", now))
        # 全件がグローバルチェーン除去を通ったうえで store_branch として 4_1 に載る
        self.assertGreaterEqual(len(branch), 30)
        self.assertTrue(all(r["account_type"] == "store_branch" for r in branch))
        self.assertTrue(all(r["discovery_seed_place_id"] for r in branch))
        # handle は run 内で一意（チェーン除去済みなので 1 handle = 1 place_id）
        self.assertEqual(len({r["handle"] for r in branch}), len(branch))


if __name__ == "__main__":
    unittest.main(verbosity=2)
