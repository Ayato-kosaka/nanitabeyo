#!/usr/bin/env python3
"""#1947 «合格線に足りない地点の 500m 圏だけを撃つ» 収集を固定する。

オーナーの合格条件（2026-09-22）は «検索結果の多い順に 70% くらいは最低でも 5 件出る»。
`7_5` が «あと何地点・どの地点か» を判定し、`4_2 --gap-points-delivery-run-id` が
**その地点の 500m 圏の店だけ**を収集する。

この試験が守るのは 1 つの形である: **どの地点が足りないかの判定を 2 箇所に書かない。**
物差し（313 地点・500m・5 店）が `4_2` 側へ写経されると、`7_5` だけ直したときに
静かにずれ、«撃ったのに動かない» の原因が分からなくなる。
"""
from __future__ import annotations

import importlib.util
import logging
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(fname: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


m75 = _load("7_5_measure_rank_coverage.py", "m75_rank_coverage")
m42 = _load("4_2_collect_account_posts.py", "m42_collect")
SRC_42 = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")


class _StubPipeline:
    """SQL とパラメータを捕まえるだけの pipeline。BigQuery へは行かない。"""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.calls: list[tuple[str, list]] = []

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql, parameters=None):
        self.calls.append((sql, list(parameters or [])))
        return list(self.rows)


def _point(pid: str, *, stores: int, best_cell: int, reachable: int,
           no_handle: int = 0, catalog_stores: int = 50) -> dict:
    """`fetch_points` が返す 1 地点ぶんの形。

    ⚠️ #1947 **ここへ列を足し忘れると、本番だけが新しい列を読んで KeyError になる。**
    `test_7_5_thin_catalog` が «SELECT の別名を全部 dict のキーにしていること» を
    機械的に見ているので、本番へ列を足したらこの fixture にも足すこと。
    `catalog_stores` の既定を大きめにしてあるのは、**既定で «天井に当たらない» 地点**に
    しておかないと «薄いから届かない» 側の分岐へ落ちてしまうためである。
    """
    return {"point": pid, "stores_500m": stores, "cats_ge5": 1 if best_cell >= 5 else 0,
            "cats_any": 1, "cell_stores": [best_cell], "reachable_500m": reachable,
            "no_handle_500m": no_handle, "catalog_stores_500m": catalog_stores}


class SevenFiveDecidesWhichPointsToShootTest(unittest.TestCase):
    """«足りない地点» の判定は 7_5 が持つ。"""

    def test_it_returns_only_points_that_have_ammunition(self):
        """弾の無い地点を返すと «撃ったのに動かない» の原因が読めなくなる。"""
        pts = [_point("ok", stores=99, best_cell=9, reachable=0),
               _point("gap_with_ammo", stores=50, best_cell=4, reachable=3),
               _point("gap_no_ammo", stores=40, best_cell=4, reachable=0)]
        picked = m75._deficit(sorted(pts, key=lambda x: -x["stores_500m"]),
                              top_pct=100, target_pct=100, quiet=True)
        self.assertIn("gap_no_ammo", picked, "判定そのものは弾の有無で地点を落とさない")
        reach = {p["point"]: p["reachable_500m"] for p in pts}
        self.assertEqual(["gap_with_ammo"], [p for p in picked if reach[p] > 0])

    def test_already_passing_points_are_not_picked(self):
        pts = [_point("ok", stores=99, best_cell=7, reachable=5)]
        self.assertEqual([], m75._deficit(pts, top_pct=100, target_pct=100, quiet=True))

    def test_it_says_which_dry_points_can_still_be_reached_by_crawling(self):
        """«撃てる弾が無い» で止めない。巡回（#1777）で届く地点を数えて出す。"""
        pts = [_point("dry_but_crawlable", stores=90, best_cell=4, reachable=0, no_handle=7),
               _point("truly_dry", stores=80, best_cell=4, reachable=0, no_handle=0)]
        lines: list[str] = []
        h = logging.Handler()
        h.emit = lambda rec: lines.append(rec.getMessage())  # type: ignore[assignment]
        m75.LOGGER.addHandler(h)
        m75.LOGGER.setLevel(logging.INFO)
        try:
            m75._deficit(pts, top_pct=100, target_pct=100)
        finally:
            m75.LOGGER.removeHandler(h)
        body = "\n".join(lines)
        self.assertIn("ハンドルすら無い店", body)
        self.assertIn("= 1 / 2", body)
        self.assertIn("店台帳そのものが薄い", body)

    def test_the_cheapest_points_come_first(self):
        """«あと 1 店» の地点を «あと 4 店» より先に撃つ。"""
        pts = [_point("far", stores=90, best_cell=1, reachable=9),
               _point("near", stores=80, best_cell=4, reachable=9)]
        picked = m75._deficit(pts, top_pct=100, target_pct=100, quiet=True)
        self.assertEqual(["near", "far"], picked)


class FourTwoNarrowsToThosePointsTest(unittest.TestCase):
    def _sql(self, **kw) -> tuple[str, list]:
        pipe = _StubPipeline()
        m42._read_accounts(pipe, ["all"], None, 100, output_run_id="r", **kw)
        return pipe.calls[-1]

    def test_without_gap_points_nothing_is_narrowed(self):
        sql, params = self._sql()
        self.assertNotIn("ST_DWithin", sql)
        self.assertNotIn("gap_pts", [p.name for p in params])

    def test_with_gap_points_only_stores_within_the_radius_are_collected(self):
        sql, params = self._sql(near_points=["A", "B"], near_radius_m=500,
                                geo_catalog_run_id="restaurant-2026-08-23")
        self.assertIn("discovery_seed_place_id IN (", sql)
        self.assertIn("ST_DWithin", sql)
        self.assertIn("500)", sql)
        by_name = {p.name: p for p in params}
        self.assertEqual(["A", "B"], list(by_name["gap_pts"].values))
        self.assertEqual("restaurant-2026-08-23", by_name["geo_rid"].value)

    def test_the_radius_is_not_hardcoded_in_the_query(self):
        """半径は 7_4 の定数から来る。ここで固定すると物差しが 2 つになる。"""
        sql, _ = self._sql(near_points=["A"], near_radius_m=800,
                           geo_catalog_run_id="restaurant-2026-08-23")
        self.assertIn("800)", sql)


class TheYardstickIsNotCopiedIntoFourTwoTest(unittest.TestCase):
    def test_four_two_does_not_name_the_sample_catalog_run(self):
        """`restaurant-2026-08-23` を 4_2 に書くと、7_4 を変えても 4_2 が古いまま残る。"""
        self.assertNotIn("restaurant-2026-08-23", SRC_42)

    def test_four_two_asks_seven_five_which_points_are_short(self):
        self.assertIn("select_gap_points", SRC_42)

    def test_gap_points_cannot_be_combined_with_the_candidate_table(self):
        """候補表は seed の店を持たないので 500m 圏で絞れない。黙って全国を撃たない。"""
        class _Args:
            gap_points_delivery_run_id = "sns-dish-media-x"
            candidate_run_id = "cand-1"
            gap_top_pct = 70
            gap_target_pct = 70
        with self.assertRaises(SystemExit):
            m42._resolve_gap_points(_StubPipeline(), _Args())


if __name__ == "__main__":
    unittest.main()
