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
import re
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
    """到達したページをどの箱へ入れるか。ここが «LLM が要るか» の数字を決める。

    ⚠️ 判定の順序を**テストへ写経しない**。本番と同じ `classify_page` を呼ぶ。
    写経すると、本番だけ直ったときに**テストが緑のまま古い順序を守り続ける**。
    """

    def classify(self, html: str) -> str:
        return measure.classify_page(measure.html_to_text(html))

    def test_parsed_page_counts_as_parsed(self) -> None:
        self.assertEqual(self.classify("<div>営業時間　11:30～14:30　定休日　月曜</div>"), "parsed")

    def test_page_with_hours_wording_but_unparsable_is_the_llm_candidate(self) -> None:
        """«人間なら読めるがパーサは諦めた» が LLM 候補。ここを取りこぼさない。"""
        html = "<div>営業時間　午後4時〜午後10時　定休日　第1・第3月曜</div>"
        self.assertIsNone(measure.parse_jp_site_opening_hours(measure.html_to_text(html)), "このパーサは午前/午後と第 n 週を読まない")
        self.assertEqual(self.classify(html), "mentions_hours_unparsed")

    def test_page_without_any_hours_wording_is_not_a_candidate(self) -> None:
        self.assertEqual(self.classify("<p>お知らせ 13:00-15:00 の講演会です</p>"), "no_hours_mentioned")

    def test_mention_net_is_wider_than_the_parser(self) -> None:
        """網はパーサより広くなければならない（狭いと候補を過小に見積もる）。"""
        for wording in ["営業時間", "営業日", "定休日", "休業日", "ランチ", "ディナー", "開店", "閉店", "OPEN"]:
            with self.subTest(wording=wording):
                self.assertTrue(measure._HOURS_MENTION_RE.search(f"当店の{wording}について"))


class NonJapanesePageTest(unittest.TestCase):
    """**日本語かどうかはページの中身で決める。`country_code` を信用しない。**

    dry-run（run 33989057072）で `--country JP` を効かせたのに韓国語サイトが標本に
    残った。つまりその行の `country_code` は 'JP' である。日本にある韓国料理店なのか
    国コードの誤りなのかはこの計測では決められないが、**どちらであっても日本語専用
    パーサの命中率の母数からは外す**のが正しい。母数に混ぜると命中率が薄まる。
    """

    def classify(self, html: str) -> str:
        return measure.classify_page(measure.html_to_text(html))

    def test_korean_page_is_excluded_from_the_denominator(self) -> None:
        html = "<div>파리바게뜨 영업시간 09:00-22:00 휴무일 월요일</div>"
        self.assertEqual(self.classify(html), "not_japanese_page")

    def test_english_page_is_excluded(self) -> None:
        """⚠️ `OPEN` は営業時間の網に入っているので、日本語判定が無いと LLM 候補に化ける。"""
        html = "<div>OPEN 11:00-14:00 Closed on Mondays</div>"
        self.assertEqual(self.classify(html), "not_japanese_page")

    def test_chinese_page_is_excluded_even_though_it_is_kanji(self) -> None:
        """漢字だけを見ると中国語ページを日本語と誤判定する。仮名で判定する理由。"""
        html = "<div>营业时间 11:00-14:00 每周一休息</div>"
        self.assertEqual(self.classify(html), "not_japanese_page")

    def test_japanese_page_without_any_kana_still_counts_as_parsed(self) -> None:
        """⚠️ **日本語判定を «仮名があるか» だけにした瞬間に落ちるテスト。**

        `営業時間 11:00-14:00 定休日 月曜` は **仮名を 1 文字も含まない日本語ページ**で、
        パーサは読める。仮名だけで弾くと `not_japanese_page` へ落ち、
        **`parsed`（= $0 で構造化できた件数）を実際より少なく報告する**。
        """
        html = "<div>営業時間 11:00-14:00 定休日 月曜</div>"
        text = measure.html_to_text(html)
        self.assertFalse(re.search(r"[ぁ-んァ-ヴー]", text), "この文には仮名が無い（前提の確認）")
        self.assertEqual(self.classify(html), "parsed")

    def test_japanese_page_is_not_excluded(self) -> None:
        html = "<div>お知らせ 本日は貸切です</div>"
        self.assertEqual(self.classify(html), "no_hours_mentioned")


class SamplingTest(unittest.TestCase):
    """標本の作り方。**ここが狂うと数字の意味が変わる。**"""

    def test_country_filter_is_in_the_sql(self) -> None:
        """⚠️ 国で絞れること。パーサは日本語専用なので、韓国語サイトを母数に混ぜると
        «日本語ページの何割を読めるか» が薄まる（dry-run の標本 20 件に 3 件あった）。
        """
        self.assertIn("country_code", measure.SAMPLE_SQL)
        self.assertIn("'ALL'", measure.SAMPLE_SQL)

    def test_sample_is_reproducible_by_seed(self) -> None:
        """同じ seed なら同じ標本。«前より良くなった» を比べるために要る。"""
        self.assertIn("md5(", measure.SAMPLE_SQL)
        self.assertIn("%(seed)s", measure.SAMPLE_SQL)

    def test_only_http_urls_are_sampled(self) -> None:
        self.assertIn("^https?://", measure.SAMPLE_SQL)

    def test_dry_run_can_show_where_the_row_actually_is(self) -> None:
        """⚠️ 標本がおかしいときに **相手のサイトを叩かずに** 確かめられること。

        韓国語サイトが JP として残った件は、緯度経度が日本国内かどうかで
        «日本にある韓国料理店» と «国コードの誤り» を切り分けられる。
        dry-run はネットワークへ出ないので、何度でも確かめてよい。
        """
        for column in ["r.country_code", "r.latitude", "r.longitude"]:
            with self.subTest(column=column):
                self.assertIn(column, measure.SAMPLE_SQL)


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
