"""#1970 4_16 の radius モード（`--cell-mode radius`）が «3 か 4» を緩めないことを固定する。

市区町村セル（`sns_coverage`）は粒度が粗く、市内に店が散っていると 500m 圏では 5 店に
届かない（#1970 の実測）。radius モードは «候補店 1 軒が何セルを埋めるか» を数える方式に
切り替える: 候補店 X の 500m 以内に、カテゴリ C を配信済みの異なり店が **3 か 4** あれば
X をそのカテゴリの候補として採る。**2 以下（集めても届かない）と 5 以上（もう足りている）
は採らない**（#1970 の完了条件）。

固定するのは境界値と、«カテゴリの当てはめに失敗した候補は点数に数えない» の 2 つ。
判定関数（`qualifying_radius_scores` / `build_radius_targets`）は BigQuery に触らない
純粋関数なので、ここでは資格情報なしで固定できる。

旧実装（city モード専用。radius モードが無い版）では、この 4 パターンはそもそも
`--cell-mode radius` という入口が無いため **全部 AttributeError で落ちる**。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "target_near_cells", HERE / "4_16_target_near_cells.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["target_near_cells"] = m
_spec.loader.exec_module(m)


QID_RAMEN = "Q_ramen"
QID_SUSHI = "Q_sushi"
QID_LABEL = {QID_RAMEN: "ラーメン", QID_SUSHI: "寿司"}


def _store(pid: str = "cand-1", *, name: str = "ラーメン花子", region: str = "東京都",
           city: str = "中央区", handle: str | None = None) -> dict:
    return {
        "google_place_id": pid, "name": name, "website": None, "region": region, "city": city,
        "handle": handle, "account_id": None, "account_type": None, "discovery_method": None,
        "site_website": None, "site_host": None, "site_handle": None, "site_status": None,
        "is_aggregator_host": None, "corroborated": None, "source_categories": [],
    }


def _score(pid: str, qid: str, n: int) -> dict:
    return {"candidate_place_id": pid, "dish_category_id": qid, "nearby_store_count": n}


class QualifyingScoresBoundaryTest(unittest.TestCase):
    """«3 か 4 のときだけ採る» の境界（qualifying_radius_scores）。"""

    def test_two_stores_is_not_enough_to_take(self) -> None:
        scores = [_score("cand-1", QID_RAMEN, 2)]
        self.assertEqual(m.qualifying_radius_scores(scores, 3, 4), [])

    def test_three_or_four_stores_are_taken(self) -> None:
        scores = [_score("cand-1", QID_RAMEN, 3), _score("cand-2", QID_RAMEN, 4)]
        kept = m.qualifying_radius_scores(scores, 3, 4)
        self.assertEqual({r["candidate_place_id"] for r in kept}, {"cand-1", "cand-2"})

    def test_five_or_more_is_already_enough_and_not_taken(self) -> None:
        scores = [_score("cand-1", QID_RAMEN, 5), _score("cand-2", QID_RAMEN, 12)]
        self.assertEqual(m.qualifying_radius_scores(scores, 3, 4), [])


class BuildRadiusTargetsTest(unittest.TestCase):
    """カテゴリの当てはめ（match_categories）を radius モードでも通す。"""

    def test_unmatched_category_is_not_scored_even_with_3_to_4_nearby(self) -> None:
        # 店名・ジャンルのどちらにも «寿司» の当てはめ語が無い候補。近傍が 3〜4 あっても
        # 点数に数えてはいけない（寿司屋を集めてもラーメンのセルは埋まらない、の逆側）。
        store = _store(name="ラーメン花子")
        cells = [_score("cand-1", QID_SUSHI, 3)]
        targets = m.build_radius_targets(cells, [store], QID_LABEL)
        self.assertEqual(targets, [])

    def test_matched_category_with_3_to_4_nearby_is_scored(self) -> None:
        store = _store(name="ラーメン花子")  # CATEGORY_KEYWORDS の "ラーメン" に店名一致
        cells = [_score("cand-1", QID_RAMEN, 4)]
        targets = m.build_radius_targets(cells, [store], QID_LABEL)
        self.assertEqual(len(targets), 1)
        t = targets[0]
        self.assertEqual(t["dish_category_id"], QID_RAMEN)
        self.assertEqual(t["distinct_store_count"], 4)
        self.assertEqual(t["candidate_total"], 1)
        self.assertEqual(t["candidates"][0]["store"]["google_place_id"], "cand-1")
        self.assertEqual(t["candidates"][0]["evidence"], "name")

    def test_candidate_missing_from_store_pool_is_skipped(self) -> None:
        # 収集済み・到達不能などで store_pool_sql の結果に居ない候補は、スコアだけ
        # あっても対象にしない（«まだ投稿を取っていない»/«手が届く» の判定を上書きしない）。
        cells = [_score("cand-missing", QID_RAMEN, 4)]
        targets = m.build_radius_targets(cells, [], QID_LABEL)
        self.assertEqual(targets, [])

    def test_end_to_end_pattern_matches_completion_criteria(self) -> None:
        """4 つのカテゴリ×近傍数から、3・4 だけが採られ、当てはめ失敗は数えないことを一度に確認する。"""
        store = _store(name="ラーメン花子")
        cells = [
            _score("cand-1", QID_RAMEN, 2),   # 採らない: 2 以下
            _score("cand-1", QID_RAMEN, 3),   # 採る（同一候補でも別カテゴリ相当として扱う）
            _score("cand-1", QID_RAMEN, 5),   # 採らない: 5 以上
        ]
        targets = m.build_radius_targets(m.qualifying_radius_scores(cells, 3, 4), [store], QID_LABEL)
        self.assertEqual([t["distinct_store_count"] for t in targets], [3])


class ResolveStoreBoundsTest(unittest.TestCase):
    """--cell-mode ごとの既定値。city の既定 4/4 は既存の挙動のまま変えない。"""

    def test_city_default_is_unchanged_4_4(self) -> None:
        self.assertEqual(m.resolve_store_bounds("city", None, None), (4, 4))

    def test_radius_default_is_3_4(self) -> None:
        self.assertEqual(m.resolve_store_bounds("radius", None, None), (3, 4))

    def test_explicit_values_override_both_modes(self) -> None:
        self.assertEqual(m.resolve_store_bounds("city", 2, 2), (2, 2))
        self.assertEqual(m.resolve_store_bounds("radius", 1, 1), (1, 1))


class ParseArgsTest(unittest.TestCase):
    def test_cell_mode_defaults_to_city(self) -> None:
        args = m.parse_args([])
        self.assertEqual(args.cell_mode, "city")
        self.assertIsNone(args.min_stores)
        self.assertIsNone(args.max_stores)

    def test_cell_mode_radius_is_accepted(self) -> None:
        args = m.parse_args(["--cell-mode", "radius", "--delivery-run-id", "sns-2026-09-11-cat2"])
        self.assertEqual(args.cell_mode, "radius")
        self.assertEqual(args.delivery_run_id, "sns-2026-09-11-cat2")

    def test_unknown_cell_mode_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            m.parse_args(["--cell-mode", "prefecture"])


if __name__ == "__main__":
    unittest.main()
