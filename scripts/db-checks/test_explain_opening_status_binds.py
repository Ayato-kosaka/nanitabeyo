#!/usr/bin/env python3
"""#1666 営業時間の番人が **測る前に落ちない**ことを固定する（DB もネットワークも不要）。

## なぜこのテストが要るか

`explain_opening_status.py --assert` は「営業時間テーブルが埋まっても検索 1 回の
重さが増えない」を守る番人である。ところが #1898（**その番人が守りたいものを
測っていなかったのを直した PR**）で、私は `SAMPLE_DOW` / `SAMPLE_DATES` を消し、

    NameError: name 'SAMPLE_DOW' is not defined

で **EXPLAIN を 1 本も投げる前に落ちる**状態にして main へ入れた。
発覚は run 34035482145、クローラが 30 万行を書き込んでいる最中である。

> **«測っていなかった» を直した PR で、«動かない» にしてしまった。**

番人は「壊れていても静かなまま」という性質があるので、**動くこと自体を縛る**。

## ⚠️ ここで DB へ繋がない

繋ぐと CI で回せなくなり、このテスト自体が «動かないまま» になる。
確かめるのは **バインド値を組み立てるところまで**である。
そこが #1898 で壊れた場所であり、DB を必要としない。

実行:
    python3 -m unittest scripts/db-checks/test_explain_opening_status_binds.py
"""

from __future__ import annotations

import datetime
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# `explain_opening_status.py` は psycopg2 を import する。CI には入っていないので、
# 「読み込めなければスキップ」ではなく **偽物を置いて必ず読み込ませる**。
# スキップにすると、壊れていても緑のまま通ってしまう（それが #1898 の再発である）。
if "psycopg2" not in sys.modules:
    import types

    stub = types.ModuleType("psycopg2")
    stub.connect = lambda *a, **k: None  # type: ignore[attr-defined]
    sys.modules["psycopg2"] = stub

_spec = importlib.util.spec_from_file_location(
    "explain_opening_status", HERE / "explain_opening_status.py"
)
explain_opening_status = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(explain_opening_status)


class SampleBindValuesTest(unittest.TestCase):
    def test_all_four_names_are_produced(self) -> None:
        values = explain_opening_status.sample_bind_values()
        self.assertEqual(
            set(values),
            {"dowToday", "dowYesterday", "dateToday", "dateYesterday"},
        )

    def test_day_of_week_uses_postgres_ordering(self) -> None:
        """0 = 日曜 … 6 = 土曜（EXTRACT(DOW) と同じ並び）。"""
        values = explain_opening_status.sample_bind_values()
        for key in ("dowToday", "dowYesterday"):
            self.assertIsInstance(values[key], int)
            self.assertIn(values[key], range(7), f"{key} が 0〜6 の外")

        today = datetime.date.today()
        self.assertEqual(values["dowToday"], today.isoweekday() % 7)

    def test_today_and_yesterday_are_consistent(self) -> None:
        """曜日と日付が食い違わない（片方だけ固定値にすると起きる）。"""
        values = explain_opening_status.sample_bind_values()
        today = datetime.date.fromisoformat(values["dateToday"])
        yesterday = datetime.date.fromisoformat(values["dateYesterday"])

        self.assertEqual((today - yesterday).days, 1)
        self.assertEqual(values["dowToday"], today.isoweekday() % 7)
        self.assertEqual(values["dowYesterday"], yesterday.isoweekday() % 7)

    def test_dates_are_not_frozen_in_the_past(self) -> None:
        """⚠️ 固定の過去日を埋め込むと、例外テーブルに 1 行も当たらず «軽い» と誤読する。"""
        values = explain_opening_status.sample_bind_values()
        self.assertEqual(values["dateToday"], datetime.date.today().isoformat())


class BindTest(unittest.TestCase):
    """#1898 で壊れたのはここ。**EXPLAIN を投げる前に落ちていた。**"""

    ALL_NAMES = [
        "lat",
        "lng",
        "radius",
        "knnLimit",
        "dowToday",
        "dowYesterday",
        "dateToday",
        "dateYesterday",
    ]

    def test_bind_does_not_raise_for_every_known_name(self) -> None:
        bound = explain_opening_status.bind(self.ALL_NAMES, 35.68, 139.76, 3000)
        self.assertEqual(len(bound), len(self.ALL_NAMES))

    def test_bind_returns_values_in_the_order_of_names(self) -> None:
        """⚠️ 順番が入れ替わると «別のクエリを測って» 読み違える（実績あり）。"""
        bound = explain_opening_status.bind(
            ["radius", "lat", "lng"], 35.68, 139.76, 3000
        )
        self.assertEqual(bound, [3000, 35.68, 139.76])

    def test_unknown_name_fails_loudly(self) -> None:
        """SQL がバインド名を増やしたら «足りない» と名指しで落ちる。"""
        with self.assertRaises(SystemExit) as caught:
            explain_opening_status.bind(["lat", "somethingNew"], 35.68, 139.76, 3000)
        self.assertIn("somethingNew", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
