"""#1841 «キャプションの店名 → place_id» を、ネットワーク無しで固定する。

固定するのは 3 つ。

1. **課金しないこと。** 送る body に fieldMask を増やす余地が無く、client が
   `1276_place_id_free_poc/free_places.py`（fieldMask 固定 + 応答検査 + Nearby 禁止）
   であること。ここが緩むと $0.00 が壊れる。
2. **判定の厳しさ。** 「市の矩形で 1 件」「店名+市区町村でも 1 件」「同じ place_id」の
   3 つ全部が揃ったときだけ確定すること。1 つでも欠けたら捨てること。
3. **店名の切り出しが TS と同じ規則であること。** resolve（API 側）は
   `shared/utils/textNormalize.ts` の `extractPinNames` でキャプションの 📍行 を読む。
   Python 側が別の規則で切ると «resolve が店名と見ていない文字列» を Google へ投げる。
   TS の定義を読んで突き合わせるので、**TS を直せばこのテストが赤くなる**。
"""

from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "1276_place_id_free_poc"))

import common_sns  # noqa: E402
import free_places  # noqa: E402
import sns_html  # noqa: E402
from free_places import SearchResult  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "resolve_place_id_by_name", HERE / "4_18_resolve_place_id_by_name.py"
)
resolver = importlib.util.module_from_spec(_spec)
sys.modules["resolve_place_id_by_name"] = resolver
_spec.loader.exec_module(resolver)

TEXT_NORMALIZE_TS = HERE.parents[1] / "shared" / "utils" / "textNormalize.ts"


class BillingGuardIsTheSharedOneTest(unittest.TestCase):
    """課金ガードを 2 つ持たない（片方だけ緩むため）。#1276 の client をそのまま使う。"""

    def test_client_is_the_free_sku_client(self) -> None:
        self.assertIs(resolver.FreePlacesClient, free_places.FreePlacesClient)

    def test_field_mask_is_still_ids_only(self) -> None:
        self.assertEqual("places.id", free_places.FIELD_MASK)
        self.assertEqual(frozenset({"id"}), free_places.ALLOWED_PLACE_KEYS)

    def test_request_bodies_never_carry_a_field_mask(self) -> None:
        """body に fieldMask を混ぜない（fieldMask は header 側で固定されている）。"""
        box = resolver.build_city_box_payload("なんどり", (35.7, 139.7, 35.8, 139.8))
        area = resolver.build_area_query_payload("なんどり", "東京都荒川区")
        for payload in (box, area):
            self.assertNotIn("fieldMask", payload)
            self.assertNotIn("X-Goog-FieldMask", payload)

    def test_box_probe_restricts_and_never_uses_nearby(self) -> None:
        """矩形は locationBias ではなく locationRestriction（外を実際に切り落とす）。"""
        box = resolver.build_city_box_payload("なんどり", (35.7, 139.7, 35.8, 139.8))
        self.assertIn("locationRestriction", box)
        self.assertNotIn("locationBias", box)
        self.assertIn("rectangle", box["locationRestriction"])
        # 位置と独立な証拠にするため、店名+市区町村のクエリには位置を付けない
        area = resolver.build_area_query_payload("なんどり", "東京都荒川区")
        self.assertNotIn("locationRestriction", area)
        self.assertNotIn("locationBias", area)
        self.assertEqual("なんどり 東京都荒川区", area["textQuery"])

    def test_nearby_search_still_raises(self) -> None:
        client = free_places.FreePlacesClient("k", rate_limiter=free_places.RateLimiter(qps=1))
        with self.assertRaises(free_places.BillableEndpointError):
            client.search_nearby({})


class CityBoxIsSaneTest(unittest.TestCase):
    def test_tiny_city_box_is_widened_to_the_minimum(self) -> None:
        payload = resolver.build_city_box_payload("店", (35.0, 139.0, 35.0, 139.0))
        rect = payload["locationRestriction"]["rectangle"]
        half_m = (rect["high"]["latitude"] - rect["low"]["latitude"]) / 2 * 111_320.0
        self.assertAlmostEqual(resolver.MIN_HALF_SIDE_M, half_m, delta=1.0)

    def test_huge_city_box_is_capped(self) -> None:
        payload = resolver.build_city_box_payload("店", (42.0, 141.0, 44.0, 143.0))
        rect = payload["locationRestriction"]["rectangle"]
        half_m = (rect["high"]["latitude"] - rect["low"]["latitude"]) / 2 * 111_320.0
        self.assertAlmostEqual(resolver.MAX_HALF_SIDE_M, half_m, delta=1.0)


class DecisionTest(unittest.TestCase):
    """#1276 box_unique_strict と同じ «1 件でも多ければ捨てる» を固定する。"""

    def _ok(self, *ids: str) -> SearchResult:
        return SearchResult(tuple(ids), 200)

    def test_unique_in_both_probes_and_agreeing_is_matched(self) -> None:
        decision = resolver.decide_name_match(self._ok("p1"), self._ok("p1"))
        self.assertEqual("p1", decision.place_id)
        self.assertEqual(resolver.DECISION_MATCHED, decision.decision)

    def test_two_in_the_box_is_rejected(self) -> None:
        decision = resolver.decide_name_match(self._ok("p1", "p2"), self._ok("p1"))
        self.assertIsNone(decision.place_id)
        self.assertEqual("city_box_not_unique", decision.decision)

    def test_two_in_the_area_query_is_rejected(self) -> None:
        decision = resolver.decide_name_match(self._ok("p1"), self._ok("p1", "p2"))
        self.assertIsNone(decision.place_id)
        self.assertEqual("area_query_not_unique", decision.decision)

    def test_disagreement_is_rejected(self) -> None:
        decision = resolver.decide_name_match(self._ok("p1"), self._ok("p2"))
        self.assertIsNone(decision.place_id)
        self.assertEqual("probes_disagree", decision.decision)

    def test_empty_results_are_rejected(self) -> None:
        self.assertEqual("no_candidate_in_city_box",
                         resolver.decide_name_match(self._ok(), self._ok("p1")).decision)
        self.assertEqual("area_query_empty",
                         resolver.decide_name_match(self._ok("p1"), self._ok()).decision)

    def test_api_error_is_not_a_rejection(self) -> None:
        """HTTP が失敗したものを «その店は無い» と混ぜない（resume で引き直すため）。"""
        broken = SearchResult((), 429, "quota")
        self.assertEqual("api_error", resolver.decide_name_match(broken, self._ok("p1")).decision)
        self.assertEqual("api_error", resolver.decide_name_match(self._ok("p1"), broken).decision)


class StoreNameExtractionTest(unittest.TestCase):
    def test_pin_line_wins_and_quoted_is_the_fallback(self) -> None:
        self.assertEqual(("下部ホテル", "pin"),
                         resolver.extract_store_name("📍下部ホテル 住所：山梨県南巨摩郡身延町"))
        self.assertEqual(("養老軒", "quoted"),
                         resolver.extract_store_name("【八王子市】『養老軒』のパフェが絶品"))

    def test_names_that_would_hit_anything_are_not_probed(self) -> None:
        # 2 文字の屋号は Google で必ず «何か» に当たる。TS の下限（2）より厳しくする。
        self.assertIsNone(resolver.extract_store_name("📍あい"))
        self.assertIsNone(resolver.extract_store_name("📍https://example.com/shop"))
        self.assertIsNone(resolver.extract_store_name("📍1234"))
        self.assertIsNone(resolver.extract_store_name("今日はいい天気でした"))

    def test_romaji_address_is_not_a_store_name(self) -> None:
        """実測で唯一の明確な誤帰属。`PIN_ADDRESS_LEAD` は日本語の «住所» しか見ない。"""
        self.assertIsNone(
            resolver.extract_store_name("📍1-16-11 aobadai, meguro-ku, tokyo, 3F"))

    def test_places_that_are_not_stores_are_not_probed(self) -> None:
        """駅・神社は place_id としては引けてしまうが «その料理を出した店» ではない。

        実測 90 件の確定のうち 9 件が最寄り駅（「北四番丁駅」等）、3 件が神社・橋だった。
        投稿をそこへ貼ると誤帰属になるので、確定率を落としてでも投げない。
        """
        for text in ("📍北四番丁駅", "「池袋駅」から徒歩5分", "📍三条八幡宮", "📍帯廣神社の花手水",
                     "📍あやとり橋", "📍のと里山空港"):
            self.assertIsNone(resolver.extract_store_name(text), text)
        # 「◯◯駅前店」は店なので落とさない
        self.assertEqual(("遊食刻 金沢駅前店", "pin"),
                         resolver.extract_store_name("📍遊食刻 金沢駅前店"))

    def test_address_pins_are_not_store_names(self) -> None:
        self.assertIsNone(resolver.extract_store_name("📍東京都八王子市東町1-3"))
        self.assertIsNone(resolver.extract_store_name("📍住所：東京都八王子市東町1-3"))


class NotAStoreNameTest(unittest.TestCase):
    """『』「」から採れる «店名でない文字列» を、Google へ投げる前に落とすこと。

    実測（2026-09-05）: 『』「」から採った 256 キーのうち店名は 41 件しか無く、
    残りは料理名・キャッチコピー・見出し・住所だった。落とすと確定率が 20.8% → 31.9% に上がり、
    request が 35% 減る。**このテストが守っているのは «確定率» ではなく «1 日 75,000 request を
    店名でない文字列に使わないこと»** である。
    """

    def _not_probed(self, *names: str) -> None:
        for name in names:
            self.assertFalse(resolver._is_probeable_name(name), name)

    def _probed(self, *names: str) -> None:
        for name in names:
            self.assertTrue(resolver._is_probeable_name(name), name)

    def test_catch_copy_is_not_probed(self) -> None:
        self._not_probed("友達や恋人を連れて行きたくなる", "ほんとうにうまいお店ってこうだよな",
                         "薬膳ってちょっと苦そう...", "今日は美味しい海鮮食べたい",
                         "日常の中の非日常を味わう")

    def test_headings_and_promotions_are_not_probed(self) -> None:
        self._not_probed("店舗情報", "鹿児島でおすすめの飲食店best3", "営業時間",
                         "ながおか米百俵フェス", "広島みなと夢花火大会",
                         "鹿児島空港 ふく福 おすすめメニューtop3")

    def test_prices_and_addresses_are_not_probed(self) -> None:
        self._not_probed("小鍋セット 1,800円", "瓶ビール¥299",
                         "鹿児島市西田1丁目3-19", "宮古島市平良西仲宗根460-5")

    def test_emoji_and_punctuation_are_not_probed(self) -> None:
        self._not_probed("みかん🍊", "いいね❤️+コメント💬", "深夜の新名物...")

    def test_dish_label_alone_is_not_probed(self) -> None:
        """アプリの料理カテゴリ名そのものは店名ではない（完全一致のときだけ落とす）。"""
        self._not_probed("かき氷")
        # 部分一致で落とすと実在の屋号を巻き添えにする（実測で確定 2 件を失った）
        self._probed("えびすそば", "船町ベースカフェ")

    def test_real_store_names_are_still_probed(self) -> None:
        """屋号に含まれる «が»«は» で落とさないこと（実測で 2 件を巻き添えにした形）。"""
        self._probed("たがみんち", "讃岐らーめん はまの", "yuhi ひがし茶屋街店",
                     "焼鳥劇場 旅鶏 裏片町店", "amusement bar rento.",
                     "wildcat house 山猫軒", "中国料理 四川飯店 新潟")

    def test_facilities_that_are_not_stores_are_not_probed(self) -> None:
        """バス停・商業施設・寺は place_id としては引けるが «料理を出した店» ではない。"""
        self._not_probed("定禅寺通市役所前", "鶴ケ谷団地入口", "ニッケコルトンプラザ",
                         "西教寺", "高松北部海水浴場")


class CityIsPickedDeterministicallyTest(unittest.TestCase):
    """同じキャプションが run ごとに別の市区町村へ落ちないこと。

    落ちる先が揺れると、4_18 が «もう聞いたキー» を別キーとして数え直し、
    1 日 75,000 request の上限を無駄に使う（実測でキー数が 238/239 と揺れた）。
    """

    BY_PAIR = {("東京都", "中央区"): (35.67, 139.77), ("新潟県", "新潟市"): (37.90, 139.02),
               ("東京都", "新宿区"): (35.69, 139.70)}
    UNIQ = {"新潟市": (37.90, 139.02)}

    def test_same_text_always_gives_the_same_city(self) -> None:
        text = "大衆馬肉酒場 うまる 新潟駅前店 新潟市の中央区みたいな場所 東京都のノリ"
        first = common_sns.city_from_text(text, self.BY_PAIR, self.UNIQ)
        for _ in range(20):
            self.assertEqual(first, common_sns.city_from_text(text, self.BY_PAIR, self.UNIQ))

    def test_city_written_right_after_the_prefecture_wins(self) -> None:
        """«東京都» と «中央区» が離れて書いてあるだけで «東京都中央区» と読まないこと。"""
        text = "東京都からわざわざ来た。新潟県新潟市の店。中央区にもあるらしい"
        self.assertEqual(("新潟県", "新潟市"),
                         common_sns.city_from_text(text, {**self.BY_PAIR,
                                                          ("新潟県", "中央区"): (0, 0)}, self.UNIQ))

    def test_longer_city_name_still_wins_over_position(self) -> None:
        text = "中央区の話。東京都八王子市のカフェ"
        by_pair = {**self.BY_PAIR, ("東京都", "八王子市"): (35.66, 139.32)}
        self.assertEqual(("東京都", "八王子市"),
                         common_sns.city_from_text(text, by_pair, self.UNIQ))


class ProbeLabelTest(unittest.TestCase):
    """«店名:» はラベルであって名前ではない。付けたまま投げない。"""

    def test_label_is_stripped_before_probing(self) -> None:
        self.assertEqual(("半助", "pin"), resolver.extract_store_name("📍店名:半助"))
        self.assertEqual(("cafe mio", "pin"), resolver.extract_store_name("📍店名: cafe mio"))
        self.assertEqual(("panda火鍋", "quoted"),
                         resolver.extract_store_name("【高松市】『店名:panda火鍋』が話題"))

    def test_label_relaxes_the_length_floor_but_nothing_else(self) -> None:
        # ラベル付き = 投稿者が «これは店名だ» と書いているので 2 文字でも投げる
        self.assertTrue(resolver._is_probeable_name("半助", labelled=True))
        self.assertFalse(resolver._is_probeable_name("半助"))
        # ラベルが付いていても «文» は投げない
        self.assertFalse(resolver._is_probeable_name("行きたくなる", labelled=True))


class PinNameExtractionTest(unittest.TestCase):
    """`shared/utils/__tests__/textNormalize.test.ts` の extractPinNames と同じ結果になること。"""

    def test_same_cases_as_the_ts_test(self) -> None:
        for raw, expected in [
            ("📍すきやきの松伊", ["すきやきの松伊"]),
            ("📍下部ホテル 住所：山梨県南巨摩郡身延町", ["下部ホテル"]),
            ("📍・カフェふね", ["カフェふね"]),
            ("📍Ｃａｆｅ Ｆｕｎｅ", ["cafe fune"]),
            ("📍CRESCENT｜松前カフェ", ["crescent"]),
            ("中華そば専門店 よしだ の一杯\n📍下部ホテル\n#ラーメン", ["下部ホテル"]),
            ("📍住所：東京都八王子市東町1-3", []),
            ("📍 東京都八王子市東町1-3", []),
            ("📍所在地：大阪府大阪市北区", []),
            ("📍TEL 03-1234-5678", []),
            ("📍北海道札幌市中央区", []),
            ("【店名】\nスターバックス", []),
            ("今日はいい天気でした", []),
            ("📍あ", []),
            ("📍" + "あ" * 41, []),
            (None, []),
            ("", []),
        ]:
            self.assertEqual(expected, sns_html.pin_names_from_text(raw), raw)

    def test_normalize_match_text_is_the_three_steps(self) -> None:
        for raw, expected in [("ＲＡＭＥＮ", "ramen"), ("ﾗｰﾒﾝ", "ラーメン"),
                              ("味噌  ラーメン", "味噌 ラーメン"), ("味噌\n\tラーメン", "味噌 ラーメン"),
                              ("  ラーメン  ", "ラーメン"), ("MISO Ramen", "miso ramen")]:
            self.assertEqual(expected, sns_html.normalize_match_text(raw), raw)


class PinNameRuleDriftTest(unittest.TestCase):
    """TS 側（正）と Python 側の «規則» が同じであることを、TS のソースを読んで確かめる。

    片側だけ育つのを止めるためのテストなので、**TS を直したらここが赤くなる**のが正しい。
    赤くなったら Python 側を TS に合わせること（逆ではない）。
    """

    def setUp(self) -> None:
        self.source = TEXT_NORMALIZE_TS.read_text(encoding="utf-8")

    def _ts_regex(self, name: str) -> tuple[str, str]:
        match = re.search(rf"^const {name} = /(.*)/([gimsuy]*);$", self.source, re.M)
        self.assertIsNotNone(match, f"{name} が textNormalize.ts に見つからない")
        return match.group(1), match.group(2)

    def _ts_number(self, name: str) -> int:
        match = re.search(rf"^export const {name} = (\d+);$", self.source, re.M)
        self.assertIsNotNone(match, f"{name} が textNormalize.ts に見つからない")
        return int(match.group(1))

    def test_regexes_match_the_typescript_source(self) -> None:
        for ts_name, py_pattern in [
            ("PIN_ADDRESS_LEAD", sns_html._RE_PIN_ADDRESS_LEAD),
            ("PIN_PREFECTURE_LEAD", sns_html._RE_PIN_PREFECTURE_LEAD),
            ("PIN_NAME_CUTOFF", sns_html._RE_PIN_NAME_CUTOFF),
            ("PIN_LEAD_SEPARATOR", sns_html._RE_PIN_LEAD_SEPARATOR),
            ("PIN_ALIAS_SEPARATOR", sns_html._RE_PIN_ALIAS_SEPARATOR),
        ]:
            source, flags = self._ts_regex(ts_name)
            self.assertEqual(source, py_pattern.pattern, ts_name)
            self.assertEqual("i" in flags, bool(py_pattern.flags & re.I), ts_name)

    def test_length_bounds_match_the_typescript_source(self) -> None:
        self.assertEqual(self._ts_number("PIN_NAME_MIN_LENGTH"), sns_html.PIN_NAME_MIN_LENGTH)
        self.assertEqual(self._ts_number("PIN_NAME_MAX_LENGTH"), sns_html.PIN_NAME_MAX_LENGTH)

    def test_pin_mark_matches(self) -> None:
        self.assertIn('const PIN_MARK = "📍";', self.source)
        self.assertEqual("📍", sns_html._PIN_MARK)


if __name__ == "__main__":
    unittest.main()


class NameSourcesTest(unittest.TestCase):
    """#1273 «📍と『』しか見ていなかった» を広げた分を固定する。

    固定するのは «その書き方から店名が採れること» と、**広げても地名・見出しを
    Google へ投げないこと**の 2 つ。地名は 1 件に確定してしまうぶん危ない
    （市役所・駅の place_id が付いた投稿が配信される）。
    """

    def test_each_way_of_writing_a_store_name_is_read(self) -> None:
        for caption, expected in [
            ("【店名】どてっぱん 京都木屋町店", ("どてっぱん 京都木屋町店", "label")),
            ("店名：麺屋こころ", ("麺屋こころ", "label")),
            ("🏠 らーめん 尾又家", ("らーめん 尾又家", "marker")),
            ("📌 御菓子処 扇屋", ("御菓子処 扇屋", "marker")),
            ("【焼肉バル ラッキールウ 金沢片町店】に行った", ("焼肉バル ラッキールウ 金沢片町店", "bracket")),
        ]:
            self.assertEqual(expected, resolver.extract_store_name(caption), caption)

    def test_the_older_ways_still_win(self) -> None:
        # 📍 と『』が同じ投稿にあるなら、そちらが確実に店名である（【】は地名の飾りにも使う）
        self.assertEqual(("養老軒", "quoted"),
                         resolver.extract_store_name("【八王子市】『養老軒』のパフェが絶品"))
        self.assertEqual(("遊食刻 金沢駅前店", "pin"),
                         resolver.extract_store_name("【金沢グルメ】\n📍遊食刻 金沢駅前店"))

    def test_bracketed_headings_are_not_store_names(self) -> None:
        for caption in ["【営業時間】11:00-22:00", "【店名】", "【メニュー】唐揚げ定食",
                        "【公式】", "【日時】6月1日", "【まとめ】"]:
            found = resolver.extract_store_name(caption)
            self.assertIsNone(found, f"{caption} -> {found}")

    def test_bracketed_place_names_are_not_probed(self) -> None:
        """【福岡市】は店名ではない。地名は 1 件に確定してしまうので、投げると誤帰属になる。"""
        by_pair = {("福岡県", "福岡市"): (33.59, 130.40), ("京都府", "京都市山科区"): (34.96, 135.81)}
        uniq = {"福岡市": (33.59, 130.40), "京都市山科区": (34.96, 135.81)}
        posts = [{"post_id": "p1", "caption": "【福岡市】【うどん 極】に行った"},
                 {"post_id": "p2", "caption": "【福岡市】の名店をまとめました"}]
        keys, reasons = resolver.build_name_keys(posts, by_pair, uniq, {"福岡市": "福岡県"})
        self.assertEqual(["うどん 極"], [k.store_name for k in keys])
        self.assertEqual(1, reasons["name_is_the_area"])

    def test_every_source_has_its_mark_in_the_sql_filter(self) -> None:
        """SQL の絞り込みは `NAME_SOURCES` と対。片方だけ足すと、その書き方は 1 件も読まれない。

        （実際、拡張前の SQL は 📍 と『「 しか通しておらず、【】の 43,468 件は
        抽出を直しても読まれないままだった。）
        """
        pattern = re.compile(resolver.CAPTION_HAS_NAME_MARK.replace("(?im)", ""),
                             re.I | re.M)
        for caption, source in [("📍まる屋", "pin"), ("『まる屋』", "quoted"),
                                ("【まる屋】", "bracket"), ("🏠まる屋", "marker"),
                                ("店名：まる屋", "label")]:
            self.assertTrue(pattern.search(caption), f"{source}: {caption} が SQL で落ちる")
            self.assertIsNotNone(resolver.extract_store_name(caption), caption)
