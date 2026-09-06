"""#1666 EXPLAIN の «延べ行数» の数え方を固定する（DB もネットワークも不要）。

⚠️ **このテストが守っているのは «測っていないものを 測った と言わない» ことである。**

`explain_opening_status.py --assert` は「営業時間テーブルが埋まっても検索 1 回の
重さが増えない」を守るための番人だが、長らく `restaurants` を読んだ行数しか
数えていなかった。つまり **営業時間テーブル側を全件舐めるプランへ倒れても緑のまま**
だった。#1666 のクローラで行が 0 → 30 万件へ増える直前にそこへ気付いたので、
両方を数えるようにし、その数え方をここで縛る。

実行:
    python3 -m unittest scripts/db-checks/test_explain_rows_read.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import explain_rows_read  # noqa: E402
from explain_rows_read import restaurants_rows_read, table_rows_read  # noqa: E402

# 実際の EXPLAIN (ANALYZE, BUFFERS) の行から必要な部分だけ写したもの。
NESTED_LOOP_PLAN = [
    "  ->  Index Scan using idx_restaurants_location on restaurants r  (cost=0.4..8.4 rows=1 width=30)"
    " (actual time=0.005..0.006 rows=1 loops=1000)",
    "  ->  Index Scan using restaurant_opening_hours_pkey on restaurant_opening_hours roh"
    "  (cost=0.4..8.4 rows=2 width=30) (actual time=0.005..0.006 rows=2 loops=1000)",
]

SEQ_SCAN_PLAN = [
    "  ->  Seq Scan on restaurant_opening_hours roh  (cost=0..99999 rows=1240000 width=30)"
    " (actual time=0.100..900.000 rows=1240000 loops=1)",
]


class LoopsAreMultipliedTest(unittest.TestCase):
    """⚠️ **rows だけ見てはいけない。** Nested Loop の内側は «loops 回まわって数行» なので、
    rows だけ数えると 1 桁小さく見え、半径に比例して重くなっているのを見逃す。
    """

    def test_rows_are_multiplied_by_loops(self) -> None:
        total, detail = table_rows_read(NESTED_LOOP_PLAN, "restaurant_opening_hours")
        self.assertEqual(total, 2 * 1000)
        self.assertEqual(len(detail), 1)

    def test_restaurants_side_is_counted_the_same_way(self) -> None:
        total, _ = restaurants_rows_read(NESTED_LOOP_PLAN)
        self.assertEqual(total, 1 * 1000)


class TableIsolationTest(unittest.TestCase):
    """⚠️ **表を取り違えないこと。** `restaurants` と `restaurant_opening_hours` は
    接頭辞が同じなので、正規表現を緩めると片方がもう片方を巻き込む。
    """

    def test_restaurants_counter_ignores_the_opening_hours_table(self) -> None:
        self.assertEqual(restaurants_rows_read(SEQ_SCAN_PLAN)[0], 0)

    def test_opening_hours_counter_ignores_the_restaurants_table(self) -> None:
        only_restaurants = [NESTED_LOOP_PLAN[0]]
        self.assertEqual(table_rows_read(only_restaurants, "restaurant_opening_hours")[0], 0)

    def test_exceptions_table_is_not_matched_by_the_hours_table(self) -> None:
        plan = [
            "  ->  Index Scan on restaurant_hours_exceptions rhe  (cost=0.4..8.4 rows=1 width=30)"
            " (actual time=0.005..0.006 rows=1 loops=1000)",
        ]
        self.assertEqual(table_rows_read(plan, "restaurant_opening_hours")[0], 0)
        self.assertEqual(table_rows_read(plan, "restaurant_hours_exceptions")[0], 1000)


class BudgetCatchesAFullScanTest(unittest.TestCase):
    """⚠️ **これが本命。** 候補集合の外まで読むプランへ倒れたら赤くなること。

    `explain_opening_status.HOURS_ROWS_BUDGET` と同じ式をここでも組む
    （あちらは psycopg2 を import するので CI から読めない）。**式を変えるなら両方**。
    """

    KNN_LIMIT = max(1000, 50 * 20)
    BUDGET = KNN_LIMIT * 2 * 10

    def test_a_bounded_plan_is_within_budget(self) -> None:
        total, _ = table_rows_read(NESTED_LOOP_PLAN, "restaurant_opening_hours")
        self.assertLessEqual(total, self.BUDGET)

    def test_a_full_scan_blows_the_budget(self) -> None:
        total, _ = table_rows_read(SEQ_SCAN_PLAN, "restaurant_opening_hours")
        self.assertGreater(total, self.BUDGET)


class AnalyzeIsRequiredTest(unittest.TestCase):
    """⚠️ ANALYZE 無しの EXPLAIN には `actual time=` が出ない。

    そのとき **0 行と数えてしまう**（＝ 何を測っても緑）。数え方の限界なので、
    «そうなる» ことを明示して残す。呼び出し側は必ず ANALYZE 付きで回すこと。
    """

    def test_a_plan_without_analyze_counts_as_zero(self) -> None:
        plan = ["  ->  Seq Scan on restaurant_opening_hours roh  (cost=0..99999 rows=1240000 width=30)"]
        self.assertEqual(table_rows_read(plan, "restaurant_opening_hours")[0], 0)



class RoundingFloorTest(unittest.TestCase):
    """#1666 `rows=` は 1 loop あたりの平均が整数へ丸められた値である。

    ⚠️ **0 を «読んでいない» と読んではいけない。** 2026-09-06 に dev で実測した
       プラン行（run 34036910547）をそのまま入力にする。この節は
       `Buffers: shared hit=2000` で **2,000 回バッファに触っている**のに `rows=0` である。
    """

    # 実測そのまま（整形もしていない）
    REAL_PLAN_LINE = (
        "->  Index Scan using idx_restaurant_hours_exceptions_date on "
        "restaurant_hours_exceptions rhe  (cost=0.15..1.27 rows=1 width=69) "
        "(actual time=0.001..0.001 rows=0 loops=1000)"
    )

    def test_real_plan_line_is_reported_as_below_the_floor(self) -> None:
        total, _detail, floor_loops = explain_rows_read.table_rows_read_with_floor(
            [self.REAL_PLAN_LINE], "restaurant_hours_exceptions"
        )
        self.assertEqual(total, 0, "延べ行数は 0 と数えられる（丸めのため）")
        self.assertEqual(
            floor_loops,
            1000,
            "⚠️ 丸めの下限に当たったことを報告していない。0 行を «軽い» と読んでしまう",
        )

    def test_loops_one_is_not_treated_as_below_the_floor(self) -> None:
        """loops=1 の 0 行は **本当に 0 行**である（丸めようがない）。"""
        line = (
            "->  Index Scan using x on restaurant_opening_hours roh "
            "(cost=0.15..1.27 rows=1 width=69) (actual time=0.001..0.001 rows=0 loops=1)"
        )
        _total, _detail, floor_loops = explain_rows_read.table_rows_read_with_floor(
            [line], "restaurant_opening_hours"
        )
        self.assertEqual(floor_loops, 0)

    def test_nonzero_rows_is_not_below_the_floor(self) -> None:
        """1 行でも出ていれば丸めの下限ではない。"""
        line = (
            "->  Index Scan using x on restaurant_opening_hours roh "
            "(cost=0.15..1.27 rows=1 width=69) (actual time=0.001..0.001 rows=2 loops=1000)"
        )
        total, _detail, floor_loops = explain_rows_read.table_rows_read_with_floor(
            [line], "restaurant_opening_hours"
        )
        self.assertEqual(total, 2000)
        self.assertEqual(floor_loops, 0)

    def test_rows_read_keeps_its_old_shape(self) -> None:
        """既存の呼び出し元を壊さない（2 つ組のまま）。"""
        total, detail = explain_rows_read.table_rows_read(
            [self.REAL_PLAN_LINE], "restaurant_hours_exceptions"
        )
        self.assertEqual(total, 0)
        self.assertEqual(len(detail), 1)


if __name__ == "__main__":
    unittest.main()
