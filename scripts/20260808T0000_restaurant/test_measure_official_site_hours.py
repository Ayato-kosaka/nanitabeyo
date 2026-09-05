"""#1666 公式サイト実測スクリプトの **ネットワークに触らない部品**を固定する。

計測本体（クロール）はネットワークが要るのでここでは回さない。固定するのは
«取ってきた HTML をどう分類するか» の 2 点だけで、そこが狂うと **数字が嘘になる**。

1. `html_to_text` が script / style / コメントを落とすこと
   → 落とさないと **JS の中の時刻表記を営業時間として拾う**
2. 「営業時間の語があるのにパーサが諦めた」を数える網（`_HOURS_MENTION_RE`）が、
   パーサの判定より **広い**こと
   → ここが狭いと «LLM 候補» を実際より少なく見積もる

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_measure_official_site_hours.py -v
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("measure_official_site_hours", HERE / "6_2_measure_official_site_hours.py")
assert _spec and _spec.loader
measure = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(measure)


class HtmlToTextTest(unittest.TestCase):
    def test_script_and_style_contents_are_dropped(self) -> None:
        """⚠️ ここが漏れると **JS の中の時刻表記を営業時間として数える**。"""
        html = (
            "<html><head><style>body{color:red}</style>"
            '<script>var x="営業時間 99:99-99:99";</script></head>'
            "<body><!-- コメント -->"
            "<div>営業時間　11:30～14:30</div></body></html>"
        )
        text = measure.html_to_text(html)
        self.assertNotIn("99:99", text)
        self.assertNotIn("コメント", text)
        self.assertIn("11:30", text)

    def test_entities_and_whitespace_are_normalized(self) -> None:
        text = measure.html_to_text("<p>営業時間&nbsp;&nbsp;11:00-14:00</p>\n\n<p>A&amp;B</p>")
        self.assertEqual(text, "営業時間 11:00-14:00 A&B")


class ClassificationTest(unittest.TestCase):
    """到達したページを 3 つに分ける判定。ここが «LLM が要るか» の数字を決める。"""

    def parse(self, text: str):
        return measure.parse_jp_site_opening_hours(text)

    def mentions(self, text: str) -> bool:
        return bool(measure._HOURS_MENTION_RE.search(text))

    def test_parsed_page_counts_as_parsed(self) -> None:
        text = measure.html_to_text("<div>営業時間　11:30～14:30　定休日　月曜</div>")
        self.assertIsNotNone(self.parse(text))

    def test_page_with_hours_wording_but_unparsable_is_the_llm_candidate(self) -> None:
        """«人間なら読めるがパーサは諦めた» が LLM 候補。ここを取りこぼさない。"""
        text = measure.html_to_text("<div>営業時間　午後4時〜午後10時　定休日　第1・第3月曜</div>")
        self.assertIsNone(self.parse(text), "このパーサは午前/午後と第 n 週を読まない")
        self.assertTrue(self.mentions(text), "営業時間の語はあるので LLM 候補として数える")

    def test_page_without_any_hours_wording_is_not_a_candidate(self) -> None:
        text = measure.html_to_text("<p>お知らせ 13:00-15:00 の講演会</p>")
        self.assertIsNone(self.parse(text))
        self.assertFalse(self.mentions(text))

    def test_mention_net_is_wider_than_the_parser(self) -> None:
        """網はパーサより広くなければならない（狭いと候補を過小に見積もる）。"""
        for wording in ["営業時間", "営業日", "定休日", "休業日", "ランチ", "ディナー", "開店", "閉店", "OPEN"]:
            with self.subTest(wording=wording):
                self.assertTrue(self.mentions(f"当店の{wording}について"))


class SafetyTest(unittest.TestCase):
    def test_public_schema_is_refused(self) -> None:
        """⚠️ 本番スキーマを読む理由がここには無い。引数で選べないことを固定する。"""
        argv = sys.argv
        sys.argv = ["prog", "--schema", "public"]
        try:
            self.assertEqual(measure.main(), 2)
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()
