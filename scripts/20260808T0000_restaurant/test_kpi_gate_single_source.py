"""#1815 KPI が数えるカテゴリの決め方を 1 箇所に固定する（134 と 140 を取り違えない）。

2026-09-05、同じ日に **2 度** «KPI の 140 QID» で数えた結論が上がってきた。
KPI は `dish_category_features_catalog` の JP ゲート（`feature_type='gate'` /
`feature_key='region:country:JP'` / `score>0`）＝ **134 個**で数える。
ラベル照合が返す 140 QID は KPI ではない。

実例: 「絵の無いカテゴリを落とすと KPI が 1 カテゴリ削れる（ナポリタン Q65241114）」は
140 側で数えた結論で、134 側では欠けるカテゴリが 0 件。**数え方が違うだけで結論が反転する。**

このテストは値ではなく **パターン**を固定する:
  1. ゲートの条件が `common_sns` に 1 つだけあること
  2. 他のスクリプトがその条件を写経していないこと
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402

GATE_MARKER = "feature_type = 'gate'"


class KpiGateSingleSource(unittest.TestCase):
    def test_gate_sql_has_all_three_conditions(self) -> None:
        sql = common_sns.kpi_gate_category_sql("proj.dish")
        for cond in (GATE_MARKER, "feature_key = @key", "score > 0"):
            self.assertIn(cond, sql, f"KPI ゲートの条件 {cond} が抜けている")
        self.assertEqual(common_sns.KPI_GATE_FEATURE_KEY, "region:country:JP")

    def test_nobody_transcribes_the_gate_condition(self) -> None:
        me = Path(__file__).name
        offenders = []
        for p in sorted(HERE.glob("*.py")):
            if p.name in (me, "common_sns.py"):
                continue
            if GATE_MARKER in p.read_text():
                offenders.append(p.name)
        self.assertEqual(
            offenders, [],
            "KPI ゲートの条件は common_sns.kpi_gate_category_sql だけが持つ。"
            "写経すると 134 と 140 の取り違えが起きる: " + ", ".join(offenders))

    def test_coverage_script_goes_through_the_single_source(self) -> None:
        src = (HERE / "7_1_build_coverage.py").read_text()
        self.assertIn("kpi_gate_category_sql", src,
                      "7_1 が KPI ゲートの共通判定を使っていない")


if __name__ == "__main__":
    unittest.main()
