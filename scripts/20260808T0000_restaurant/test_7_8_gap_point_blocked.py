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
        """«緩める» は数えるだけで、打ち手として出さない。"""
        self.assertIn("«緩める» 提案はしない", SRC)
        self.assertIn("品質ゲートを緩めること", SRC)
        self.assertIn("オーナー判断の領分", SRC)


class AnyLeverMustReachTheKpiGateTest(unittest.TestCase):
    """KPI は 134 カテゴリのゲートを通った分しか数えない。

    2026-09-23、«絵の無い 20 カテゴリに絵を足せば 29 店が通る» と報告して外した。
    その 20 カテゴリは **全部ゲートの外**で、絵を足しても KPI には 1 ミリも効かない
    （実測: ゲート内 134 カテゴリのうち絵が無いものは **0**）。

    > **打ち手を出す前に、それが KPI のゲートを通るのかを確かめる。**
    """

    def test_the_image_gap_is_split_by_the_kpi_gate(self):
        self.assertIn("category_without_image_in_gate", SQL)
        self.assertIn("gate AS (", SQL)

    def test_it_also_counts_what_falls_outside_the_gate(self):
        """ゲート外の件数を隠さない（隠すと «なぜ増えないのか» が追えなくなる）。"""
        self.assertIn("outside_gate", SQL)

    def test_the_gate_comes_from_common_sns(self):
        self.assertIn("kpi_gate_category_sql", SRC)

    def test_it_says_so_when_the_image_lever_is_dead(self):
        self.assertIn("絵を足しても KPI は動かない", SRC)


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


class TheConfidenceThresholdIsBoundTest(unittest.TestCase):
    """`@min_conf` を束ね忘れると 400 で落ちる（2026-09-23 に踏んだ）。"""

    def test_the_parameter_is_bound_from_the_shared_constant(self):
        self.assertIn('ScalarQueryParameter("min_conf"', SRC)
        self.assertIn("MIN_RESTAURANT_CONFIDENCE", SRC)

    def test_the_threshold_value_is_not_written_in_the_code(self):
        """閾値の数字をコードやログ文言に書くと、9_1 を変えたときに静かにずれる。

        docstring の «0.60» は 9_1 の実測結果の引用なので対象外。**実行される行だけ**を見る。
        """
        body = SRC.split('"""', 2)[-1]
        code = "\n".join(ln for ln in body.splitlines()
                          if not ln.lstrip().startswith("#"))
        self.assertNotIn("0.60", code)


class WhyTheCategoryIsMissingIsBrokenDown(unittest.TestCase):
    """#1947 «カテゴリが付かない» を件数だけで止めない。

    2026-09-23 から «合格線の地点の近くでカテゴリの付かない投稿» が «打ち手未特定» の
    まま残っていた。件数は出ていたが **どこで付かなかったか**を数えていなかったので、
    打ち手（キャプション後入れ / 抽出改善 / しきい値）を選べなかった。
    """

    DS = "food-scroll.restaurant_recommendation"

    def test_it_splits_by_where_it_failed(self) -> None:
        sql = m.build_no_category_reason_sql(self.DS, radius_m=500)
        self.assertIn("キャプションが無い", sql)
        self.assertIn("cat=0", sql)
        self.assertIn("dish_category_id IS NULL", sql)

    def test_it_uses_the_shared_store_linkage(self) -> None:
        """«seed も使う» 結び付けを写経しない（resolve 済みの店だけで数えると桁が変わる）。"""
        sql = m.build_no_category_reason_sql(self.DS, radius_m=500)
        self.assertIn("post_store", sql)
        src = (HERE / "7_8_measure_gap_point_blocked.py").read_text(encoding="utf-8")
        self.assertEqual(src.count("post_store_cte_sql("), 2,
                         "2 つの build_sql が同じ定義を呼ぶこと（片方だけ写経しない）")


class TheSampleAndTheCountSeeTheSameThing(unittest.TestCase):
    """#1947 «B を 1,683 件と数える式» と «B の実例を出す式» が同じ母集団であること。

    2026-09-25、未達 22 地点の近くに «キャプションが平均 232 文字あるのに料理名を 1 つも
    取れていない» 投稿が 1,683 件（109 店）あると分かった。ここから抽出側を直すには
    実物が要るが、**数える式と拾う式を別々に書くと片方だけ直って «数は出るのに実例が
    出ない» になる**（このリポジトリで fixture と検知 SQL で 2 回起きた形）。
    """

    DS = "food-scroll.restaurant_recommendation"

    def test_both_come_from_one_cte_definition(self) -> None:
        a = m.build_no_category_reason_sql(self.DS, radius_m=500)
        b = m.build_no_category_sample_sql(self.DS, radius_m=500)
        cte = m._near_gap_ctes_sql(self.DS, radius_m=500)
        self.assertIn(cte, a)
        self.assertIn(cte, b)

    def test_the_b_condition_is_written_once(self) -> None:
        """B の判定（`cat=0`）は定数 1 本で、両方の SQL がそれを埋め込んでいること。"""
        import re
        a = m.build_no_category_reason_sql(self.DS, radius_m=500)
        b = m.build_no_category_sample_sql(self.DS, radius_m=500)
        self.assertIn(m.B_NO_DISH_NAME_SQL, a)
        self.assertIn(m.B_NO_DISH_NAME_SQL, b)
        src = (HERE / "7_8_measure_gap_point_blocked.py").read_text(encoding="utf-8")
        body = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
        literal = re.findall(r"REGEXP_CONTAINS\(IFNULL\(v\.resolve_reason", body)
        self.assertEqual(len(literal), 1,
                         "判定の実体は 1 箇所だけ（他は B_NO_DISH_NAME_SQL を埋める）")

    def test_the_sample_only_returns_b(self) -> None:
        sql = m.build_no_category_sample_sql(self.DS, radius_m=500)
        self.assertIn("dish_category_id IS NULL", sql)
        self.assertIn("cat=0", sql)
        # A（キャプションが無い）を実例に混ぜない。混ざると «抽出が悪い» を読み違える。
        self.assertIn("caption IS NOT NULL", sql)
        self.assertIn("LIMIT @n", sql)

    def test_the_sample_prints_the_whole_caption(self) -> None:
        """要約した実例からは打ち手が出せない。全文を出していること。"""
        src = (HERE / "7_8_measure_gap_point_blocked.py").read_text(encoding="utf-8")
        self.assertIn('LOGGER.info("    caption: %s"', src)
        self.assertNotIn("caption[:", src)
