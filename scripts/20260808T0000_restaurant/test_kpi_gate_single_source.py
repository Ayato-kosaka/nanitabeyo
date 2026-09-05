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

    def test_nobody_outside_common_sns_counts_kpi_with_the_140_table(self) -> None:
        """«KPI» と名乗って数えるのに 140 QID の表を使わない。

        写経の禁止（上のテスト）だけでは **逆向きの間違い**が通ってしまう。
        実例 2026-09-05: `9_2_sync_sns_dish_media.export_catalog` は戻り値を
        «KPI 134 カテゴリ外の行数» と書きながら `_kpi_tables()`（140 QID）で数えていた。
        catalog run `sns-catalog-2026-09-05c` の異なり店で **134 は 18,747 / 140 は 19,005**、
        258 店ずれる。同じ日に上がってきた «KPI 19,005 店» もこの 140 側の数字だった。

        `_kpi_tables()` は private で、**カテゴリを «選ぶ» ため**（`pick_kpi_category`）の
        ものである。common_sns の外へ持ち出した時点で «数える» 用途に化けるので、
        持ち出し自体を禁止する。

        当てはまらないもの（なぜ当てはまらないかを残す。書かないと次の人がまた調べ直す）:
        - `4_7_collect_search_api_posts.py`: 140 の **ラベル**で検索クエリを組む。
          «どこを採りに行くか» の targeting であって KPI を数えていない
        - `4_18_resolve_place_id_by_name.py`: 140 の **ラベル**を店名から落とすために使う。
          同上
        """
        me = Path(__file__).name
        offenders = []
        for p in sorted(HERE.glob("*.py")):
            if p.name in (me, "common_sns.py"):
                continue
            if "_kpi_tables" in p.read_text():
                offenders.append(p.name)
        self.assertEqual(
            offenders, [],
            "KPI を数えるなら kpi_gate_category_sql（JP ゲート＝134）を通す。"
            "_kpi_tables() は 140 QID で、選ぶため専用: " + ", ".join(offenders))


if __name__ == "__main__":
    unittest.main()
