#!/usr/bin/env python3
"""#1881 `country_resolution` を **作った規則とは別の根拠**で確かめる。

## なぜこの形なのか

#1881 の欠陥は「矩形で国を決めた」ことではなく、**その矩形で検証もしていた**ことである。

> 作った規則と同じ規則で検証しているので、構造的に何を作っても緑になる。

だからこのテストは、判定の規則（接尾辞の表・正規表現）を **1 文字も参照しない**。
入力は **dev に実在する住所そのもの**で、期待値は **人が住所を読んで付けたラベル**である。

⚠️ **ここへ «実装がこう返すから» という期待値を書かないこと。** それを始めた瞬間、
   このテストは #1881 と同じ循環に戻る。

住所の出どころ: run 34032063455（dev / 読み取り専用）が出した実サンプル。
"""

from __future__ import annotations

import unittest

from country_resolution import country_code_from_address

# (住所, 人が付けた国コード, なぜそう読めるか)
#
# ⚠️ 「実装がこう返した」ではなく「**住所を読むとこう書いてある**」を書く。
LABELLED_REAL_ADDRESSES: tuple[tuple[str, str | None, str], ...] = (
    # --- dev に実在する韓国の店（run 34032063455 のサンプル） -----------------
    ("고덕 국제3길 97", "KR", "ハングル"),
    ("근흥면 신진도리 522-23", "KR", "ハングル（근흥면＝勤興面）"),
    ("성산구 삼귀로 159", "KR", "ハングル（성산구＝城山区）"),
    ("남포동2가 25-10", "KR", "ハングル（남포동＝南浦洞）"),
    ("26-8 Bupyeong-dong 2(i)-ga", "KR", "富平洞のローマ字。-dong / -ga"),
    ("106-7 Sosabon-dong", "KR", "素砂本洞のローマ字。-dong"),
    ("1046-13 Gwonseon-dong", "KR", "勧善洞のローマ字。-dong"),
    ("111-13 Nonhyeon-dong", "KR", "論峴洞のローマ字。-dong"),
    ("61 Seongseong 2-gil", "KR", "城城2ギル。-gil は韓国の «길»"),
    ("15-1 Myeongnyun-ro 129beonda-gil", "KR", "明倫路。-ro / beon-gil"),
    ("374 Palbonghyangsan-gil, Salmi-myeon", "KR", "-gil と -myeon（面）"),
    ("670-2 Ami-ri, Bubal-eup", "KR", "-ri（里）と -eup（邑）"),
    ("161-12 Yongsu-ri, Jeonggwan-eup", "KR", "-ri と -eup"),
    ("60 Apgujeong-ro 2-gil", "KR", "狎鴎亭路。-ro / -gil"),
    ("Chuncheon-ro 151beon-gil, 19 KR", "KR", "末尾に国コード KR が明示されている"),
    ("Bungmunno 2(i)-ga, Jungang-ro, 2 2층", "KR", "-ga / -ro とハングル"),
    ("Dongtanyeok-ro, 128 중앙파크뷰 105호", "KR", "-ro とハングル"),
    ("Sohyang-ro, 55-15 승재밀레니엄 123호", "KR", "-ro とハングル"),
    ("Myeonmok-dong, 501 3번지 102호", "KR", "-dong とハングル"),
    ("819호, Hoban Metro Cube, 647번지 Sampyeong-dong", "KR", "-dong とハングル"),
    ("미래로 375", "KR", "ハングル"),
    ("중문관광로72번길 67", "KR", "ハングル（済州島 中文）"),

    # --- dev に実在する日本の店 ------------------------------------------------
    # ⚠️ 対馬は **韓国のすぐ隣にある日本**。座標で切ると必ず巻き込まれる。
    ("長崎県対馬市厳原町宮谷２３６", "JP", "「長崎県対馬市」と書いてある"),

    # --- dev に実在するロシアの店 ----------------------------------------------
    ("ул. Героев Хасана, 4", "RU", "キリル文字のロシア語住所（ウラジオストク）"),

    # --- 日本の住所（表記ゆれ） --------------------------------------------------
    ("東京都渋谷区神南1-2-3", "JP", "「東京都渋谷区」"),
    ("〒150-0041 東京都渋谷区神南1丁目", "JP", "郵便番号と都県市区"),
    ("大阪府大阪市北区梅田3-1-3", "JP", "「大阪府大阪市北区」"),
    ("1-2-3 Jinnan, Shibuya-ku, Tokyo", "JP", "-ku（区）は日本。韓国は -gu"),
    ("Naka-machi 3-1, Musashino-shi", "JP", "-machi / -shi は日本。韓国は -si"),
    ("北海道札幌市中央区南1条西4丁目", "JP", "「北海道札幌市」と丁目"),
    ("沖縄県石垣市美崎町1", "JP", "「沖縄県石垣市」"),

    # --- 決められないもの（**None を返すのが正しい**） -------------------------
    ("", None, "空"),
    ("Some Street 12", None, "国を示すものが何も無い"),
    ("123", None, "番地だけ"),
    ("Main Street", None, "通り名だけ"),
)


class CountryCodeFromAddressTest(unittest.TestCase):
    def test_labelled_real_addresses(self) -> None:
        wrong: list[str] = []
        for address, expected, why in LABELLED_REAL_ADDRESSES:
            actual = country_code_from_address(address)
            if actual != expected:
                wrong.append(f"{address!r}: 期待 {expected} / 実際 {actual}（{why}）")
        self.assertEqual(wrong, [], "\n".join(wrong))

    def test_never_guesses_when_there_is_no_signal(self) -> None:
        """⚠️ **手掛かりが無いのに断言しない。** 矩形の欠陥はここだった。"""
        for address in ("", "   ", None, "1", "Building A", "3F"):
            self.assertIsNone(
                country_code_from_address(address), f"{address!r} を断言している"
            )

    def test_does_not_look_at_coordinates(self) -> None:
        """座標を渡せる形にしてはいけない（#1881 の欠陥そのものになる）。"""
        import inspect

        signature = inspect.signature(country_code_from_address)
        names = set(signature.parameters)
        self.assertEqual(names, {"address"}, f"引数が増えている: {names}")

    def test_country_token_beats_script(self) -> None:
        """住所に国が明示されていれば、文字種より優先する。"""
        self.assertEqual(
            country_code_from_address("서울 어딘가, Japan"),
            "JP",
            "明示された国名より文字種を優先している",
        )

    def test_partial_word_is_not_a_country(self) -> None:
        """`KR` や `JP` の部分一致で誤爆しない。"""
        for address in ("KRAFT Building 3F", "JPEG Street 1", "Koreatown Ave 5"):
            self.assertNotIn(
                country_code_from_address(address),
                ("KR", "JP"),
                f"{address!r} を国コードと読んでいる",
            )


if __name__ == "__main__":
    unittest.main()
