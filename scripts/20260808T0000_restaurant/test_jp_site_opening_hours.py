"""#1666 公式サイトの日本語自由記述パーサを固定する（DB もネットワークも不要）。

⚠️ **このテストが守っている一番のことは «推測しない» である。**
扱えない形は必ず `None` を返す。#1666 の 3 値判定では unknown は害が無いが、
間違って closed にすると **開いている店が検索から消える**。

とくに `WholeTextIsRefusedTest` が要である。**営業時間だけ読めても、定休日が読めなければ
全体を諦める**。時間だけ入れて «第 1・第 3 月曜定休» を落とすと、休みの日に開いていることになる。

入力の多くは #843 の[実現性の実測（10 件）](https://github.com/Ayato-kosaka/nanitabeyo/issues/843#issuecomment-5429418172)
で**実際のサイトから採れた原文**である。作った例文ではないので、ここが通ることには意味がある。

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_jp_site_opening_hours.py -v
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jp_site_opening_hours import parse_jp_site_opening_hours as parse

# 0 = 日曜 … 6 = 土曜
SUN, MON, TUE, WED, THU, FRI, SAT = range(7)


def dows(rows) -> set[int]:
    return {r.day_of_week for r in rows}


def spans(rows, dow: int) -> set[tuple[str, str]]:
    return {(r.opens_at, r.closes_at) for r in rows if r.day_of_week == dow}


class RealWorldSitesTest(unittest.TestCase):
    """#843 の実測で実際のサイトから採れた原文。"""

    def test_kisouan_two_spans_and_two_closed_days(self) -> None:
        """喜想菴: 昼夜 2 コマ + 月火定休。**定休日が落ちること**が要点。"""
        rows = parse("営業時間のご案内　【昼】11：30～14：30　【夕】18：00～21：00　定休日　月曜、火曜")
        assert rows is not None
        self.assertEqual(dows(rows), {WED, THU, FRI, SAT, SUN})
        self.assertNotIn(MON, dows(rows))
        self.assertNotIn(TUE, dows(rows))
        self.assertEqual(spans(rows, WED), {("11:30", "14:30"), ("18:00", "21:00")})

    def test_sushi_madoka_weekday_and_weekend_same_hours(self) -> None:
        """寿司まどか: 平日と土日祝が同じ時間 → 全曜日 2 コマ。"""
        rows = parse(
            "【平日】・店内営業　ランチ営業：11:00～14:30 (入店14:00まで)　"
            "ディナー営業：17:00～21:30 (入店21:00まで)　【土日祝】ランチ営業：11:00～14:30 "
            "(入店14:00まで)　ディナー営業：17:00～21:30 (入店21:00まで)"
        )
        assert rows is not None
        self.assertEqual(dows(rows), set(range(7)))
        self.assertEqual(spans(rows, MON), {("11:00", "14:30"), ("17:00", "21:30")})
        self.assertEqual(spans(rows, SAT), {("11:00", "14:30"), ("17:00", "21:30")})

    def test_figaro_weekday_with_one_closed_day_plus_weekend(self) -> None:
        """喀茶フィガロ: 平日 11-18（木曜定休）+ 土日 8-16。

        ⚠️ **木曜だけが落ちて、土日は別の時間帯で残る**のが正しい。
        «定休日を全曜日に適用してしまう» と土日まで消える。
        """
        rows = parse("営業時間　平日(祝日含む)　11:00～18:00（木曜定休）　土日　8:00～16:00")
        assert rows is not None
        self.assertNotIn(THU, dows(rows))
        self.assertEqual(spans(rows, MON), {("11:00", "18:00")})
        self.assertEqual(spans(rows, SAT), {("08:00", "16:00")})
        self.assertEqual(spans(rows, SUN), {("08:00", "16:00")})


class WholeTextIsRefusedTest(unittest.TestCase):
    """⚠️ **ここが一番大事。** 一部が読めても、危ないものは文章ごと諦める。"""

    def test_nth_weekday_closure_refuses_even_though_hours_are_readable(self) -> None:
        """俵屋: 時間は読めるが «第1･第3月曜定休» が曜日へ落とせない。

        時間だけ入れると **第 1 月曜に «開いている» ことにされる**ので、全体を諦める。
        """
        self.assertIsNone(
            parse(
                "営業時間　平日ランチ 11:30～14:00 (L.O.13:30)　土日祝日ランチ 11:30～14:30 "
                "(L.O.14:00)　ディナー 17:30～21:30 (L.O.21:00)　"
                "定休日　第1･第3月曜日、第2・第4日曜日 定休"
            )
        )

    def test_am_pm_prose_is_refused(self) -> None:
        """山どり: 「午後４時〜午後10時」は時刻の解釈が割れるので読まない。"""
        self.assertIsNone(
            parse("営業時間　平日　午後４時〜午後10時　土・日　午前11時３０〜　定休日　毎週　火曜日・水曜日")
        )

    def test_irregular_closure_is_refused(self) -> None:
        self.assertIsNone(parse("営業時間 11:00-22:00 定休日 不定休"))

    def test_closed_declaration_without_readable_weekday_is_refused(self) -> None:
        """「定休日」と書いてあるのに曜日が読めない → 諦める（落とす日が分からない）。"""
        self.assertIsNone(parse("営業時間 11:00-22:00 定休日 詳しくはお問い合わせください"))

    def test_text_without_any_time_span_is_refused(self) -> None:
        self.assertIsNone(parse("ランチ営業しています。お気軽にどうぞ。"))
        self.assertIsNone(parse(""))
        self.assertIsNone(parse(None))

    def test_open_ended_span_is_refused(self) -> None:
        """終了時刻が無い「11:30〜」は区間にならない。"""
        self.assertIsNone(parse("営業時間 11:30〜 ラストオーダーは14:00です"))

    def test_time_span_without_opening_context_is_refused(self) -> None:
        """⚠️ **実際に踏んだ穴。** 曜日も区分も無い時刻を無条件に «毎日の営業時間» と
        読むと、**営業時間ではない数字で全曜日を埋める**。

        自由記述のページには時刻の区間がいくらでも出てくる（催しの告知、ラストオーダー、
        アクセスの電車時刻…）。«営業時間の話をしている» と読める語が無ければ諦める。
        """
        self.assertIsNone(parse("新春セミナーのご案内 13:00-15:00 会場は2階です"))
        self.assertIsNone(parse("第3回 料理教室 10:00-12:00 参加費は無料です"))

    def test_opening_context_allows_the_every_day_reading(self) -> None:
        """逆に «営業時間» と書いてあれば、曜日が無くても毎日として読む。"""
        rows = parse("営業時間 11:00-14:00")
        assert rows is not None
        self.assertEqual(dows(rows), set(range(7)))


class NonJapaneseTextIsRefusedTest(unittest.TestCase):
    """⚠️ **実際に踏んだ穴（#1666 の計測で発覚）。**

    `_OPENING_CONTEXT_RE` に `OPEN` / `Open` が入っているせいで、**英語・韓国語のページが
    «営業時間の話をしている» と判定されていた**。このモジュールの休業日の判定
    （`定休日` / `不定休`）は日本語しか読まないので、いったん非日本語のページが通ると
    **止める仕組みが 1 つも無い**。実測では `Closed on Mondays` と書いてあるページから
    **月曜を含む 7 行**ができていた。

    `dish_media` の店に当てれば «休みの日に開いている» と表示される。
    パーサが読めない言語は **読まずに諦める**（unknown は候補から消えないので害が無い）。
    """

    def test_english_page_is_refused(self) -> None:
        self.assertIsNone(parse("OPEN 11:00-14:00 Closed on Mondays"))
        self.assertIsNone(parse("Open 9:00-17:00"))
        self.assertIsNone(parse("Restaurant OPEN 11:00 - 22:00. Closed Sunday."))

    def test_korean_page_is_refused(self) -> None:
        """dev には country_code='JP' のまま韓国語サイトを持つ行がある（#1666 dry-run）。"""
        self.assertIsNone(parse("파리바게뜨 영업시간 OPEN 09:00-22:00 휴무일 월요일"))

    def test_chinese_page_is_refused(self) -> None:
        """«营业时间 / 營業時間» は日本語の «営業時間» と字が違う。当たってはいけない。"""
        self.assertIsNone(parse("营业时间 OPEN 11:00-14:00 每周一休息"))
        self.assertIsNone(parse("營業時間 OPEN 11:00-14:00"))

    def test_japanese_page_without_any_kana_is_still_read(self) -> None:
        """⚠️ 逆方向の番人。**«日本語 = 仮名がある» にすると日本語ページを落とす。**

        `営業時間 11:00-14:00 定休日 月曜` には仮名が 1 文字も無いが日本語である。
        ここを落とすと «$0 で構造化できた件数» を実際より少なく報告する。
        """
        text = "営業時間 11:00-14:00 定休日 月曜"
        self.assertIsNone(re.search(r"[ぁ-んァ-ヴー]", text), "この文には仮名が無い（前提の確認）")
        rows = parse(text)
        assert rows is not None
        self.assertEqual(dows(rows), {0, 2, 3, 4, 5, 6}, "月曜だけ落ちる")


class GrammarTest(unittest.TestCase):
    def test_no_weekday_means_every_day(self) -> None:
        rows = parse("営業時間 11:00-14:00")
        assert rows is not None
        self.assertEqual(dows(rows), set(range(7)))

    def test_weekday_range(self) -> None:
        rows = parse("月曜-金曜 09:00-17:00")
        assert rows is not None
        self.assertEqual(dows(rows), {MON, TUE, WED, THU, FRI})

    def test_weekday_enumeration(self) -> None:
        rows = parse("月・水・金 18:00-23:00")
        assert rows is not None
        self.assertEqual(dows(rows), {MON, WED, FRI})

    def test_full_width_digits_and_tilde(self) -> None:
        rows = parse("営業時間　１１：００～１４：３０")
        assert rows is not None
        self.assertEqual(spans(rows, MON), {("11:00", "14:30")})

    def test_late_night_span_crosses_midnight(self) -> None:
        rows = parse("営業時間 18:00-02:00")
        assert rows is not None
        self.assertTrue(all(r.crosses_midnight for r in rows))
        self.assertEqual(spans(rows, MON), {("18:00", "02:00")})

    def test_over_24_hour_notation_folds_to_next_day(self) -> None:
        """26:00 = 翌 2:00（`osm_opening_hours.py` と同じ規則）。"""
        rows = parse("営業時間 18:00-26:00")
        assert rows is not None
        self.assertEqual(spans(rows, MON), {("18:00", "02:00")})
        self.assertTrue(all(r.crosses_midnight for r in rows))

    def test_rows_are_deduplicated(self) -> None:
        """同じ区間が 2 回書いてあっても行は増えない。"""
        rows = parse("営業時間 11:00-14:00 ランチ 11:00-14:00")
        assert rows is not None
        self.assertEqual(len(rows), 7)


class ContractWithOsmParserTest(unittest.TestCase):
    """`osm_opening_hours.py` と同じ行の形を返す（DB の列がひとつだから）。"""

    def test_returns_osm_opening_hour_rows(self) -> None:
        from osm_opening_hours import OpeningHourRow

        rows = parse("営業時間 11:00-14:00")
        assert rows is not None
        self.assertTrue(all(isinstance(r, OpeningHourRow) for r in rows))

    def test_day_of_week_uses_postgres_dow_numbering(self) -> None:
        """0 = 日曜 … 6 = 土曜。ここがずれると «月曜の営業時間» が日曜に入る。"""
        rows = parse("日曜 10:00-12:00")
        assert rows is not None
        self.assertEqual(dows(rows), {0})
        rows = parse("土曜 10:00-12:00")
        assert rows is not None
        self.assertEqual(dows(rows), {6})


if __name__ == "__main__":
    unittest.main()
