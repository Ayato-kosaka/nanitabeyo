"""#1947 «5 店» が死んだ埋め込みに寄りかかっている量を数える（7_5 --fragility）。

2026-09-24、配信中の埋め込みの **6.53% が既に削除済み**だと実測した（`4_22`・1,500 投稿で 98 件）。
ところが `9_1`（配信）も `7_5`（合格線）も `7_4`（カバレッジ）も **死活を 1 度も見ていない**。
つまり «5 店» の中に «開くと利用できません» が混ざりうる。

⚠️ 下がり幅は 6.53% ではない。投稿が 1 本死んでも、その店に別の生きた投稿があれば店は残る。
落ちるのは «そのカテゴリで投稿が 1 本しか無い店» だけである。

このテストは値ではなく **パターン**を固定する:
  1. «5 店以上» の判定は `_base_cte_sql` の 1 箇所を使う（合格線側と同じもの）
  2. 余裕（stores - 5）を超えて死なないと落ちない
  3. **最悪ケースと期待値を両方出す**（最悪ケースだけだと «これだけ落ちる» と誤読される）
  4. 死亡率は実測値の定数を使い、推測値をコードへ置かない
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "7_5_measure_rank_coverage.py"

_spec = importlib.util.spec_from_file_location("m75f", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")

DS, DISH = "food-scroll.restaurant_recommendation", "food-scroll.wikidata_food_graph"


class TheCellDefinitionIsShared(unittest.TestCase):
    def test_both_builders_use_the_same_base(self) -> None:
        self.assertEqual(SRC.count("_base_cte_sql(ds, dish_ds"), 2,
                         "合格線側と脆さ側が同じ土台を使うこと（写経しない）")

    def test_the_near_join_is_defined_once(self) -> None:
        self.assertEqual(SRC.count("SELECT p.pid AS point, d.pid AS store"), 1)

    def test_fragility_keeps_the_five_store_threshold(self) -> None:
        sql = m.build_fragility_sql(DS, DISH, sample_n=313, radius_m=500)
        self.assertIn("stores >= 5", sql)
        self.assertIn("single_post_stores", sql)


def _last_line_before_main_select(sql: str) -> str:
    """WITH 節の最後の行（コメント・空行を除く）を返す。"""
    lines = sql.splitlines()
    idx = max(i for i, l in enumerate(lines) if l.strip().startswith("SELECT"))
    for l in reversed(lines[:idx]):
        t = l.strip()
        if t and not t.startswith("--"):
            return t
    return ""


class TheWithClauseDoesNotEndWithAComma(unittest.TestCase):
    """#1947 «WITH の最後に , を残したまま本体の SELECT へ入る» を静的に止める。

    2026-09-24 に踏んだ: `achieving AS (...)` を消して素の SELECT にしたとき、その前の
    `cell AS (...)` の後ろのカンマを消し忘れ、BigQuery が
    «Trailing comma after the WITH clause before the main query is not allowed» で 400。
    ⚠️ **コメント行を挟むと目で見つけにくい**（実際その形で見落とした）ので機械で見る。
    """

    def test_fragility_sql(self) -> None:
        last = _last_line_before_main_select(
            m.build_fragility_sql(DS, DISH, sample_n=313, radius_m=500))
        self.assertFalse(last.endswith(","), f"WITH 節がカンマで終わっている: {last!r}")

    def test_rank_sql(self) -> None:
        last = _last_line_before_main_select(
            m.build_sql(DS, DISH, sample_n=313, sample_run="r", radius_m=500))
        self.assertFalse(last.endswith(","), f"WITH 節がカンマで終わっている: {last!r}")


class ACellFallsOnlyWhenItRunsOutOfSlack(unittest.TestCase):
    def test_no_single_post_store_means_it_cannot_fall(self) -> None:
        self.assertEqual(m._cell_fall_probability(5, 0), 0.0)

    def test_slack_absorbs_the_deaths(self) -> None:
        """10 店のセルは 1 本店が 5 つ死んでも 5 店残る。"""
        self.assertEqual(m._cell_fall_probability(10, 5), 0.0)

    def test_a_bare_five_is_the_most_fragile(self) -> None:
        bare = m._cell_fall_probability(5, 5)
        roomy = m._cell_fall_probability(6, 6)
        self.assertGreater(bare, roomy)
        self.assertLess(bare, 0.5, "6.53% の死亡率で «半分落ちる» はあり得ない")

    def test_the_probability_matches_the_binomial_tail(self) -> None:
        # 5 店すべてが 1 本しか無い → 1 つでも死ねば落ちる
        expected = 1 - (1 - m.DEAD_SHARE) ** 5
        self.assertAlmostEqual(m._cell_fall_probability(5, 5), expected, places=10)


class TheDeathRateIsMeasuredNotGuessed(unittest.TestCase):
    def test_it_is_the_measured_value(self) -> None:
        self.assertAlmostEqual(m.DEAD_SHARE, 0.0653, places=4)

    def test_the_source_of_the_number_is_written_down(self) -> None:
        self.assertIn("4_22_probe_embed_liveness", SRC)
        self.assertIn("1,500", SRC)


class BothTheWorstCaseAndTheExpectedValueAreReported(unittest.TestCase):
    def test_the_report_says_both(self) -> None:
        self.assertIn("最悪ケース", SRC)
        self.assertIn("期待値", SRC)

    def test_it_warns_against_reading_the_worst_case_as_the_answer(self) -> None:
        # ⚠️ 失敗メッセージにソース全文を出さない（読めない）。有無だけを言う。
        self.assertTrue("最悪ケースは" in SRC and "上限" in SRC,
                        "最悪ケースを «これだけ落ちる» と読ませない注意書きが無い")


if __name__ == "__main__":
    unittest.main()
