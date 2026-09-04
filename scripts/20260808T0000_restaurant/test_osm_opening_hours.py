"""#1666 OSM の opening_hours パーサを固定する（DB もネットワークも不要）。

⚠️ **このテストが守っている一番のことは «推測しない» である。**
扱えない形は必ず `None` を返す。#1666 の 3 値判定では unknown は害が無いが、
間違って closed にすると **開いている店が検索から消える**。

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_osm_opening_hours.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from osm_opening_hours import OpeningHourRow, parse_osm_opening_hours as parse


class DayOfWeekMappingTest(unittest.TestCase):
    """0 = 日曜 … 6 = 土曜（PostgreSQL の EXTRACT(DOW) と同じ並び）。

    ⚠️ OSM は Mo 始まりで書くが、DB は Su 始まりで数える。**ここがずれると
       «月曜の営業時間» が日曜に入る**（画面では気付きにくい）。
    """

    def test_each_weekday_maps_to_postgres_dow(self) -> None:
        expected = {"Su": 0, "Mo": 1, "Tu": 2, "We": 3, "Th": 4, "Fr": 5, "Sa": 6}
        for token, dow in expected.items():
            rows = parse(f"{token} 09:00-17:00")
            self.assertIsNotNone(rows, token)
            self.assertEqual([r.day_of_week for r in rows], [dow], token)

    def test_range_expands_in_osm_order(self) -> None:
        rows = parse("Mo-Fr 09:00-17:00")
        self.assertEqual(sorted(r.day_of_week for r in rows), [1, 2, 3, 4, 5])

    def test_range_wraps_around_the_week(self) -> None:
        """Fr-Mo は 金土日月。端で切らずに回り込む。"""
        rows = parse("Fr-Mo 10:00-12:00")
        self.assertEqual(sorted(r.day_of_week for r in rows), [0, 1, 5, 6])


class SupportedFormsTest(unittest.TestCase):
    def test_24_7_covers_every_day(self) -> None:
        rows = parse("24/7")
        self.assertEqual(sorted(r.day_of_week for r in rows), list(range(7)))
        self.assertTrue(all(r.crosses_midnight for r in rows))

    def test_multiple_spans_in_one_day(self) -> None:
        """昼と夜。1 日に複数行が出る（主キーに opens_at が入っているのはこのため）。"""
        rows = parse("Mo 11:00-14:00,17:00-22:00")
        self.assertEqual(
            sorted(rows),
            [
                OpeningHourRow(1, "11:00", "14:00", False),
                OpeningHourRow(1, "17:00", "22:00", False),
            ],
        )

    def test_multiple_rules(self) -> None:
        rows = parse("Mo-Fr 09:00-17:00; Sa,Su 12:00-15:00")
        self.assertEqual(len(rows), 7)

    def test_off_day_produces_no_row(self) -> None:
        """休業日は «行を作らない»。«00:00-00:00 の行» にしない（24 時間営業と区別が付かなくなる）。"""
        rows = parse("Mo-Fr 09:00-17:00; Su off")
        self.assertEqual(sorted(r.day_of_week for r in rows), [1, 2, 3, 4, 5])

    def test_public_holiday_selector_is_dropped(self) -> None:
        """PH（祝日）は曜日ではないので、曜日の行にしない。"""
        rows = parse("Mo-Fr 09:00-17:00; PH off")
        self.assertEqual(sorted(r.day_of_week for r in rows), [1, 2, 3, 4, 5])

    def test_later_rule_wins_for_the_same_day_and_open_time(self) -> None:
        """後のルールが前を上書きする（OSM の意味論）。"""
        rows = parse("Mo-Su 09:00-17:00; Mo 09:00-12:00")
        monday = [r for r in rows if r.day_of_week == 1]
        self.assertEqual(monday, [OpeningHourRow(1, "09:00", "12:00", False)])


class MeasuredOnRealDataTest(unittest.TestCase):
    """⚠️ **実データを測って初めて分かった 3 件。** どれも最初は «扱えない» にしていた。

    上位 3,000 値（24,419 店の 69.3%）で測ったところ、扱えたのは 64.3% しかなかった。
    下の 3 つを直して **97.8%** になった。**仕様を読んだつもりで書いた分岐が、
    実データでは最大の取りこぼしだった。**
    """

    def test_rule_without_weekday_means_every_day(self) -> None:
        """⚠️ 取りこぼしの最大要因。OSM 仕様では曜日を省略したルールは «毎日»。

        «曜日が無いものを毎日と解釈するのは危ない» と考えて拒否していたが、
        これは仕様の読み違いだった（実データでも最頻出）。
        """
        rows = parse("11:00-23:00")
        self.assertEqual(sorted(r.day_of_week for r in rows), list(range(7)))
        self.assertTrue(all(r.opens_at == "11:00" and r.closes_at == "23:00" for r in rows))

    def test_comma_followed_by_space(self) -> None:
        """"11:00-15:00, 17:00-22:00" のようにカンマの後ろに空白が入る書き方がある。

        先に潰さないと、空白で分割したときに «曜日 + 時刻» と誤読して丸ごと捨てる。
        """
        rows = parse("11:00-15:00, 17:00-22:00")
        self.assertEqual(len(rows), 14)  # 2 コマ × 7 曜日

    def test_hours_past_24_mean_next_day(self) -> None:
        """OSM は «翌日へ食い込む閉店» を 24 時超えで書く（26:00 = 翌 2:00）。"""
        rows = parse("18:00-26:00")
        self.assertTrue(all(r.closes_at == "02:00" for r in rows))
        self.assertTrue(all(r.crosses_midnight for r in rows))


class CrossesMidnightTest(unittest.TestCase):
    """DB 側の CHECK と同じ規則であること。ここがずれると判定 SQL が静かに間違える。"""

    def test_normal_hours_do_not_cross(self) -> None:
        self.assertFalse(parse("Mo 09:00-17:00")[0].crosses_midnight)

    def test_late_night_crosses(self) -> None:
        self.assertTrue(parse("Mo 18:00-02:00")[0].crosses_midnight)

    def test_same_open_and_close_is_24h_and_counts_as_crossing(self) -> None:
        """closes == opens は «24 時間営業»。DB の CHECK も またぐ 側に入れている。"""
        self.assertTrue(parse("Mo 00:00-24:00")[0].crosses_midnight)


class RefusedFormsTest(unittest.TestCase):
    """⚠️ **ここが本命。** 扱えないものを推測で埋めない。

    unknown は «今までどおり候補に残る» ので害が無い。間違って closed にすると
    開いている店が検索から消える。
    """

    def test_refuses_what_it_cannot_represent(self) -> None:
        cases = {
            "Jan-Mar Mo-Fr 09:00-17:00": "月・季節の指定",
            "Mo[1] 09:00-17:00": "第 n 月曜",
            "Mo-Fr sunrise-sunset": "日の出・日の入り",
            "17:00+": "終了時刻が無い",
            "Mo-Sa": "時刻が無い",
            '11:00-23:00 "please validate"': "自由記述のコメント付き",
            "week 1-10 Mo-Fr 09:00-17:00": "週指定",
            "": "空文字",
            None: "None",
        }
        for value, why in cases.items():
            self.assertIsNone(parse(value), f"{value!r} は扱えないはず（{why}）")

    def test_refuses_broken_times(self) -> None:
        for value in ("Mo 25:00-99:00", "Mo 09:70-17:00", "Mo 09:00-48:00"):
            self.assertIsNone(parse(value), value)


if __name__ == "__main__":
    unittest.main()
