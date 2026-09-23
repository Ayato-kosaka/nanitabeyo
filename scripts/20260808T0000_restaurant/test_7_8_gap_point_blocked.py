#!/usr/bin/env python3
"""#1947 «合格線の近くで、品質ゲートに止められている投稿» の数え方を固定する。

合格線に足りない 25 地点には «まだ呼んでいない handle» が 1 つも無い。
無料の発見経路も 4 本とも閉じた。残る可能性は **«採ったのに配信していない投稿»** で、
`9_1` は 1 ビルドあたり «カテゴリに絵が無い 27,809 / 確からしさ 0.60 未満 6,544» を落としている。

⚠️ この試験が守るのは **«緩める» と «足す» を混ぜないこと**。
絵が無いのは絵を 1 枚足せば通る。確からしさはゲートを緩めないと通らない（オーナー判断）。
2 つを合算して «あと N 店で届く» と報告すると、**品質を落とす提案を成果に見せかける**ことになる。
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
_spec = importlib.util.spec_from_file_location("m78", HERE / "7_8_measure_gap_point_blocked.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["m78"] = m
_spec.loader.exec_module(m)

SRC = (HERE / "7_8_measure_gap_point_blocked.py").read_text(encoding="utf-8")
SQL = m.build_sql("food-scroll.restaurant_recommendation", "food-scroll.wikidata_food_graph",
                  radius_m=500)


class TheGatesAreCountedSeparatelyTest(unittest.TestCase):
    def test_image_and_confidence_are_never_summed(self):
        """1 つの数字に足すと «緩める» が «足す» に紛れる。"""
        self.assertIn("category_without_image", SQL)
        self.assertIn("low_confidence", SQL)
        self.assertNotIn("category_without_image + low_confidence", SQL)

    def test_confidence_is_only_counted_where_the_image_gate_passes(self):
        """絵が無い投稿を確からしさの側でも数えると、二重計上になる。"""
        self.assertIn("IN (SELECT dish_category_id FROM category_with_image)\n"
                      "              AND NOT (", SQL)

    def test_it_never_proposes_loosening_the_gate(self):
        self.assertIn("品質ゲートを緩めない", SRC)
        self.assertIn("オーナー判断の領分", SRC)


class ItUsesTheProductionRulesTest(unittest.TestCase):
    def test_the_gates_come_from_common_sns(self):
        """9_1 と同じ式を借りる（写経すると 9_1 だけ直したときに静かにずれる）。"""
        self.assertIn("category_with_image_cte_sql", SRC)
        self.assertIn("resolved_store_confidence_sql", SRC)
        self.assertIn("post_store_cte_sql", SRC)

    def test_which_points_are_short_is_decided_by_seven_five(self):
        self.assertIn("select_gap_points", SRC)
        self.assertIn("reachable_only=False", SRC)

    def test_zero_posts_is_reported_as_not_collected_not_as_no_room(self):
        self.assertIn("そもそも集まっていない", SRC)


if __name__ == "__main__":
    unittest.main()
