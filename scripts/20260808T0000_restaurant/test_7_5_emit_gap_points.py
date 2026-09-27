"""#1947 «弾が無い» ときに未達地点の id を隠さない。

2026-09-27、合格線に足りない 22 地点の «撃てる弾» が 0 件になった。このとき
`7_5 --emit-gap-points` は «撃てる弾のある未達地点 0 件: » とだけ出し、
**22 地点の google_place_id をどこにも出さなかった**。そのため «その地点の店に
website があるか（= CC WAT でハンドルを掘れる見込みがあるか）» のような
次の調査を、地点を指定して行うことができなかった。

欠陥のパターンは «診断の道具が、いちばん困っている状態でだけ情報を落とす» である。
値ではなくこの形を固定する: 弾の有無に関わらず、未達地点の一覧は必ず出る。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "7_5_measure_rank_coverage.py"

_spec = importlib.util.spec_from_file_location("m75emit", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def _pts(**reach: int) -> list[dict]:
    return [{"point": k, "reachable_500m": v} for k, v in reach.items()]


class TheGapPointsAreAlwaysPrinted(unittest.TestCase):
    def test_no_bullets_still_lists_every_gap_point(self) -> None:
        """弾が 1 つも無くても 22 地点ぶんの id が出る（これが起きた事故）。"""
        picked = [f"ChIJ{i}" for i in range(22)]
        lines = m.gap_point_lines(picked, _pts(**{p: 0 for p in picked}))
        joined = "\n".join(lines)
        self.assertIn("22 件", joined)
        for pid in picked:
            self.assertIn(pid, joined)

    def test_the_collection_entry_line_keeps_its_meaning(self) -> None:
        """«撃てる弾のある» の行は 4_2 の入口。弾のある地点だけを出し続ける。"""
        lines = m.gap_point_lines(["A", "B", "C"], _pts(A=3, B=0, C=7))
        self.assertEqual(lines[0], "  ⚑ 撃てる弾のある未達地点 2 件: A,C")

    def test_both_lines_are_emitted_for_every_case(self) -> None:
        for reach in ({"A": 0}, {"A": 5}):
            with self.subTest(reach=reach):
                self.assertEqual(len(m.gap_point_lines(["A"], _pts(**reach))), 2)

    def test_a_point_missing_from_pts_is_not_counted_as_shootable(self) -> None:
        """pts に無い地点を «弾がある» 側へ落とさない（旧コードの .get 既定値と同じ）。"""
        lines = m.gap_point_lines(["A"], _pts(B=9))
        self.assertEqual(lines[0], "  ⚑ 撃てる弾のある未達地点 0 件: ")
        self.assertIn("A", lines[1])


class TheCallerDoesNotRebuildTheLines(unittest.TestCase):
    def test_main_delegates_to_the_pure_function(self) -> None:
        """判定を main へ写経し直すと、テストが緑のまま出力だけ古くなる。"""
        src = SOURCE.read_text(encoding="utf-8")
        body = src.split("def main(")[1]
        self.assertIn("gap_point_lines(picked, pts)", body)
        self.assertNotIn("撃てる弾のある未達地点 %d 件", body)


if __name__ == "__main__":
    unittest.main()
