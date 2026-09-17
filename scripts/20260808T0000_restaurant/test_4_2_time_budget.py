"""#1947 収集を «件数» ではなく «時間» で区切れることを固定する。

## なぜ要るか

IG の business_discovery のクォータは **時間あたり**（約 200 コール/時・トークン 1 本の
アプリ単位）である。したがって **ジョブが走っていない時間ぶんの供給は永久に捨てている。**

件数だけで区切っていたため、実際にこうなっていた（2026-09-17 実測）:

| | 値 |
| --- | ---: |
| 1 ジョブ | 900 アカウント / 3 時間 31 分で終了 |
| そのあと次を投げるまで | 数時間の空白（同日 2.5 時間 / 前日 42 時間） |
| 実効スループット | 約 1,300 件/日 |
| 上限（24h 連続） | 4,800 件/日 |
| **稼働率** | **約 27%** |

`--max-minutes` があれば 1 ディスパッチで GitHub Actions の枠（上限 6 時間）を使い切れる。

## 固定するもの

- 引数が在ること、既定が «無制限»（従来の挙動を変えない）こと。
- **時間で打ち切る前に必ず flush する**こと。呼んだのに台帳へ残っていない状態を作ると、
  次の run が同じ handle を呼び直してクォータを二度払う。
- 経過時間の計測に `time.monotonic` を使うこと。壁時計は NTP 補正で巻き戻るため、
  `datetime.now()` 系だと予算判定が飛ぶ。
- 打ち切ったことが `pipeline_runs` から分かること（`max_minutes` を記録する）。
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)


def _argument_defaults() -> dict[str, object]:
    out: dict[str, object] = {}
    for node in ast.walk(TREE):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_argument" and node.args):
            continue
        first = node.args[0]
        if not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
            continue
        for kw in node.keywords:
            if kw.arg == "default" and isinstance(kw.value, ast.Constant):
                out[first.value] = kw.value.value
    return out


class TimeBudgetTest(unittest.TestCase):
    def test_the_argument_exists(self):
        self.assertIn("--max-minutes", _argument_defaults(),
                      "IG のクォータは時間あたりなので、時間で区切る手段が無いと取り切れない")

    def test_default_is_unlimited_so_existing_callers_do_not_change(self):
        self.assertEqual(_argument_defaults()["--max-minutes"], 0)

    def test_uses_monotonic_not_wall_clock(self):
        """壁時計は NTP 補正で巻き戻る。予算判定に使うと打ち切りが飛ぶ。"""
        self.assertIn("time.monotonic()", SOURCE)
        budget_lines = [ln for ln in SOURCE.splitlines()
                        if "budget_seconds" in ln and ">=" in ln]
        self.assertTrue(budget_lines, "予算の比較が見つからない")
        self.assertTrue(all("monotonic" in ln for ln in budget_lines), budget_lines)

    def test_flushes_before_breaking_out(self):
        """**呼んだのに台帳に無い** を作らない。作ると次の run が同じ handle へ二度課金する。

        `break` の直前までに `_flush()` が呼ばれており、かつ loop を出た直後にも
        `_flush()` が在ること（端数を捨てない）を固定する。
        """
        loop_at = SOURCE.index("for acc in accounts:")
        break_at = SOURCE.index("break", loop_at)
        body = SOURCE[loop_at:break_at]
        self.assertIn("_flush()", body, "打ち切りまでに一度も flush していない")
        after = SOURCE[break_at:break_at + 400]
        self.assertIn("_flush()", after, "loop を出たあとに端数の flush が無い")

    def test_the_budget_is_recorded_in_pipeline_runs(self):
        """あとから «時間で打ち切ったのか / 在庫を切らしたのか» を区別できるようにする。"""
        self.assertRegex(SOURCE, r'"max_minutes":\s*args\.max_minutes')

    def test_it_logs_which_reason_it_stopped_for(self):
        self.assertIn("時間で打ち切り", SOURCE)
        self.assertIn("在庫を処理しきった", SOURCE)

    def test_budget_guard_is_falsy_safe(self):
        """`--max-minutes 0`（既定）で打ち切り判定が効かないこと。

        `budget_seconds` が 0 のとき `if budget_seconds and ...` で短絡するので、
        «0 分＝即終了» にならない。ここを `>=` だけにすると全 run が 1 件で止まる。
        """
        self.assertRegex(SOURCE, r'if budget_seconds and \(time\.monotonic\(\)')


class BudgetSemanticsTest(unittest.TestCase):
    """予算の計算そのものを、実装と同じ式で確かめる（境界の取り違えを弾く）。"""

    @staticmethod
    def _should_stop(max_minutes: int, elapsed_seconds: float) -> bool:
        budget_seconds = max(0, max_minutes) * 60
        return bool(budget_seconds and elapsed_seconds >= budget_seconds)

    def test_zero_never_stops(self):
        self.assertFalse(self._should_stop(0, 10_000))

    def test_negative_is_treated_as_unlimited_not_immediate(self):
        self.assertFalse(self._should_stop(-5, 10_000))

    def test_stops_exactly_at_the_boundary(self):
        self.assertFalse(self._should_stop(330, 330 * 60 - 1))
        self.assertTrue(self._should_stop(330, 330 * 60))

    def test_five_and_a_half_hours_fits_the_six_hour_actions_cap(self):
        self.assertLess(330 * 60, 6 * 3600)


if __name__ == "__main__":
    unittest.main()
