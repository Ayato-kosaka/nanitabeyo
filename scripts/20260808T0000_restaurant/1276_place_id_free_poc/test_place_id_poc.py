#!/usr/bin/env python3
"""ネットワークなしで、課金ガード・住所クエリ組立・判定ルールを固定する。"""

from __future__ import annotations

import unittest

import http.client

from free_places import (
    ALLOWED_PLACE_KEYS,
    DETAILS_FIELD_MASK,
    FIELD_MASK,
    RETRYABLE_EXCEPTIONS,
    BillingGuardError,
    SearchResult,
    extract_place_ids,
)
from matching import (
    EXPORT_SAFE_RULES,
    GEO_ABSENT,
    GEO_CONFIRMED,
    GEO_INCONCLUSIVE,
    PROBE_A,
    PROBE_B,
    PROBE_C,
    PROBE_C_TIGHT,
    PROBE_C_WIDE,
    PROBE_NEARBY,
    RULES,
    STATUS_AMBIGUOUS,
    STATUS_API_ERROR,
    STATUS_INELIGIBLE,
    STATUS_MATCHED,
    STATUS_UNMATCHED,
    geo_status,
)
from ground_truth import chain_key
from jp_text import name_similarity, normalize_for_comparison
from seeds import (
    Seed,
    body_nearby,
    body_query_a,
    body_query_b,
    body_query_c,
    build_address_query,
    format_postcode,
    normalize_postcode_digits,
    normalize_name_for_query,
    strip_bracket_tail,
)


def make_seed(**overrides) -> Seed:
    base = dict(
        seed_id="seed-1",
        name="町中華 龍月",
        name_query="町中華 龍月",
        address_query="〒103-0021 東京都中央区日本橋本石町4-5-12",
        address_quality="prefecture_and_postcode",
        latitude=35.6,
        longitude=139.7,
        postcode="103-0021",
        freeform="東京都中央区日本橋本石町4-5-12",
        locality="中央区",
        basic_category="restaurant",
        confidence=0.8,
        websites="",
    )
    base.update(overrides)
    return Seed(**base)


class BillingGuardTest(unittest.TestCase):
    def test_field_mask_is_ids_only(self) -> None:
        self.assertEqual(FIELD_MASK, "places.id")
        self.assertEqual(set(ALLOWED_PLACE_KEYS), {"id"})

    def test_details_field_mask_is_ids_only(self) -> None:
        # ID Refresh も Essentials (IDs Only) SKU に留める。単一 place を引くので
        # 接頭辞 places. が付かない点だけが検索と違う。
        self.assertEqual(DETAILS_FIELD_MASK, "id")

    def test_single_place_response_is_accepted(self) -> None:
        # Place Details は places 配列ではなく place 単体を返す。
        self.assertEqual(extract_place_ids({"id": "A"}), ("A",))

    def test_extract_ids_deduplicates_in_order(self) -> None:
        document = {"places": [{"id": "A"}, {"id": "B"}, {"id": "A"}]}
        self.assertEqual(extract_place_ids(document), ("A", "B"))

    def test_empty_response_is_allowed(self) -> None:
        self.assertEqual(extract_place_ids({}), ())

    def test_billable_field_stops_the_run(self) -> None:
        document = {"places": [{"id": "A", "displayName": {"text": "x"}}]}
        with self.assertRaises(BillingGuardError):
            extract_place_ids(document)

    def test_unexpected_top_level_key_stops_the_run(self) -> None:
        with self.assertRaises(BillingGuardError):
            extract_place_ids({"places": [], "contextualContents": []})

    def test_disconnects_are_retryable(self) -> None:
        # urllib はこれを URLError で包まないため、素通りすると worker thread ごと
        # 実行が落ちる。長時間の一括実行で実際に発生した。
        self.assertIsInstance(
            http.client.RemoteDisconnected("closed"), RETRYABLE_EXCEPTIONS
        )
        self.assertIsInstance(ConnectionResetError(), RETRYABLE_EXCEPTIONS)


class QueryBuildingTest(unittest.TestCase):
    def test_postcode_formats(self) -> None:
        self.assertEqual(format_postcode("1030021"), "103-0021")
        self.assertEqual(format_postcode("103-0021"), "103-0021")
        self.assertEqual(format_postcode(""), "")
        self.assertEqual(format_postcode("abc"), "")

    def test_name_normalization_keeps_branch_but_drops_corporate_form(self) -> None:
        self.assertEqual(normalize_name_for_query("株式会社　ドミノ・ピザ 渋谷店"), "ドミノ・ピザ 渋谷店")
        self.assertEqual(normalize_name_for_query("ラーメン太郎　有限会社"), "ラーメン太郎")
        self.assertEqual(normalize_name_for_query("〒103-0021 蕎麦屋"), "蕎麦屋")

    def test_bracket_tail_variant(self) -> None:
        self.assertEqual(strip_bracket_tail("Mermaid Cafe（マーメイドカフェ）"), "Mermaid Cafe")
        self.assertEqual(strip_bracket_tail("龍月"), "龍月")

    def test_address_query_is_built_from_the_most_reliable_geography(self) -> None:
        # freeform に都道府県が入っていれば、それだけで住所は一意に定まる。
        self.assertEqual(
            build_address_query("東京都中央区日本橋1-1", "1030021", "中央区"),
            ("東京都中央区日本橋1-1", "prefecture_in_freeform"),
        )
        # 都道府県が無い行は郵便番号から作り直す。Overture の locality が誤って
        # いても（この郵便番号の行は locality=Ogasawara-mura だった）正しくなる。
        self.assertEqual(
            build_address_query("志茂2-48-10", "1150042", "Ogasawara-mura"),
            ("東京都北区志茂2-48-10", "postcode_expanded_and_partial"),
        )
        # freeform が空なら町域名まで補う。
        self.assertEqual(
            build_address_query("", "1002101", ""), ("東京都小笠原村父島", "postcode_expanded")
        )
        # 郵便番号の町域と freeform の町名が食い違っても、矛盾した住所を作らない。
        self.assertEqual(
            build_address_query("田村町235-1", "5150073", "松阪市"),
            ("三重県松阪市田村町235-1", "postcode_expanded_and_partial"),
        )
        self.assertEqual(build_address_query(None, None), ("", "none"))

    def test_postcode_digits_survive_real_world_formatting(self) -> None:
        # 全角や、ハイフンの代わりに長音記号が入った行が実データに存在する。
        self.assertEqual(normalize_postcode_digits("１５０ｰ００４４"), "1500044")
        self.assertEqual(normalize_postcode_digits("542ー0083"), "5420083")
        self.assertEqual(normalize_postcode_digits("103-0021"), "1030021")
        self.assertIsNone(normalize_postcode_digits("103-002"))
        self.assertIsNone(normalize_postcode_digits(""))

    def test_locality_is_used_only_when_nothing_better_exists(self) -> None:
        # 住所も郵便番号も無い行では、locality が唯一の地理情報になる。
        self.assertEqual(build_address_query("", None, "東大阪市"), ("東大阪市", "locality_only"))
        self.assertEqual(
            build_address_query("港北区新横浜2丁目6-17", None, "横浜市"),
            ("横浜市 港北区新横浜2丁目6-17", "locality_and_partial"),
        )
        # ローマ字の locality は検索の役に立たず誤りも多いので使わない。
        self.assertEqual(build_address_query("", None, "Chiyoda-ku"), ("", "none"))

    def test_page_size_is_twenty(self) -> None:
        # IDs Only は件数に依らず $0.00 なので、曖昧さを取りこぼさない上限を使う。
        self.assertEqual(body_query_a(make_seed())["pageSize"], 20)
        self.assertEqual(body_query_b(make_seed())["pageSize"], 20)

    def test_query_bodies_stay_within_free_sku_shape(self) -> None:
        seed = make_seed()
        body_a = body_query_a(seed, radius_m=150.0)
        self.assertEqual(body_a["textQuery"], seed.name_query)
        self.assertEqual(body_a["locationBias"]["circle"]["radius"], 150.0)
        body_b = body_query_b(seed)
        self.assertNotIn("locationBias", body_b)
        self.assertIn(seed.address_query, body_b["textQuery"])
        body_c = body_query_c(seed, half_side_m=75.0)
        rectangle = body_c["locationRestriction"]["rectangle"]
        self.assertNotIn("locationBias", body_c)
        self.assertLess(rectangle["low"]["latitude"], seed.latitude)
        self.assertGreater(rectangle["high"]["latitude"], seed.latitude)
        self.assertAlmostEqual(
            (rectangle["high"]["latitude"] - rectangle["low"]["latitude"]) * 111_320.0, 150.0, places=3
        )
        nearby = body_nearby(seed, radius_m=40.0)
        self.assertEqual(nearby["locationRestriction"]["circle"]["radius"], 40.0)
        self.assertEqual(nearby["rankPreference"], "DISTANCE")


class GeoStatusTest(unittest.TestCase):
    def test_box_probe_decides_when_present(self) -> None:
        probes = {PROBE_C: SearchResult(("A", "B"), 200)}
        self.assertEqual(geo_status("A", probes), GEO_CONFIRMED)

    def test_box_probe_absence_is_conclusive(self) -> None:
        # 矩形 restriction は矩形外を実際に落とすので、件数上限を気にせず absent と言える。
        self.assertEqual(geo_status("A", {PROBE_C: SearchResult(("B",), 200)}), GEO_ABSENT)
        self.assertEqual(geo_status("A", {PROBE_C: SearchResult((), 200)}), GEO_ABSENT)

    def test_failed_box_probe_falls_back_to_nearby(self) -> None:
        probes = {PROBE_C: SearchResult((), 500, "boom"), PROBE_NEARBY: SearchResult(("A",), 200)}
        self.assertEqual(geo_status("A", probes), GEO_CONFIRMED)

    def test_nearby_absent_from_short_list_is_absent(self) -> None:
        self.assertEqual(geo_status("A", {PROBE_NEARBY: SearchResult(("B", "C"), 200)}), GEO_ABSENT)

    def test_nearby_truncated_list_is_inconclusive(self) -> None:
        nearby = SearchResult(tuple(f"P{i}" for i in range(20)), 200)
        self.assertEqual(geo_status("A", {PROBE_NEARBY: nearby}), GEO_INCONCLUSIVE)

    def test_no_geo_evidence_is_inconclusive(self) -> None:
        self.assertEqual(geo_status("A", {PROBE_NEARBY: SearchResult((), 200)}), GEO_INCONCLUSIVE)
        self.assertEqual(geo_status("A", {}), GEO_INCONCLUSIVE)
        self.assertEqual(geo_status(None, {PROBE_C: SearchResult(("A",), 200)}), GEO_INCONCLUSIVE)


class RuleTest(unittest.TestCase):
    def probes(self, a, b, box=("A",), nearby=None) -> dict:
        probes = {
            PROBE_A: SearchResult(tuple(a), 200),
            PROBE_B: SearchResult(tuple(b), 200),
        }
        if box is not None:
            probes[PROBE_C] = SearchResult(tuple(box), 200)
        if nearby is not None:
            probes[PROBE_NEARBY] = SearchResult(tuple(nearby), 200)
        return probes

    def test_strict_unique_matches_only_on_single_agreement(self) -> None:
        rule = RULES["strict_unique"]
        self.assertEqual(rule(make_seed(), self.probes(["A"], ["A"])).status, STATUS_MATCHED)
        self.assertEqual(rule(make_seed(), self.probes(["A", "B"], ["A"])).status, STATUS_AMBIGUOUS)
        self.assertEqual(rule(make_seed(), self.probes(["A"], ["B"])).status, STATUS_AMBIGUOUS)
        self.assertEqual(rule(make_seed(), self.probes([], ["B"])).status, STATUS_UNMATCHED)

    def test_top1_agree_relaxes_the_count_condition(self) -> None:
        rule = RULES["top1_agree"]
        decision = rule(make_seed(), self.probes(["A", "B"], ["A", "C"]))
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.place_id, "A")
        self.assertEqual(rule(make_seed(), self.probes(["B", "A"], ["A", "C"])).status, STATUS_AMBIGUOUS)

    def test_intersection_unique(self) -> None:
        rule = RULES["intersection_unique"]
        self.assertEqual(rule(make_seed(), self.probes(["B", "A"], ["A", "C"])).place_id, "A")
        self.assertEqual(
            rule(make_seed(), self.probes(["A", "B"], ["B", "A"])).status, STATUS_AMBIGUOUS
        )
        self.assertEqual(rule(make_seed(), self.probes(["A"], ["B"])).status, STATUS_AMBIGUOUS)

    def test_geo_gate_hard_requires_confirmation(self) -> None:
        hard = RULES["top1_agree_geo_hard"]
        soft = RULES["top1_agree_geo_soft"]
        unconfirmed = self.probes(
            ["A"], ["A"], box=None, nearby=tuple(f"P{i}" for i in range(20))
        )
        self.assertEqual(hard(make_seed(), unconfirmed).status, STATUS_AMBIGUOUS)
        self.assertEqual(soft(make_seed(), unconfirmed).status, STATUS_MATCHED)

    def test_geo_absent_is_rejected_by_both_gates(self) -> None:
        probes = self.probes(["A"], ["A"], box=("X", "Y"))
        self.assertEqual(RULES["top1_agree_geo_soft"](make_seed(), probes).status, STATUS_AMBIGUOUS)
        self.assertEqual(RULES["top1_agree_geo_hard"](make_seed(), probes).status, STATUS_AMBIGUOUS)

    def test_missing_address_is_ineligible(self) -> None:
        seed = make_seed(address_query="", address_quality="none")
        self.assertEqual(RULES["strict_unique"](seed, self.probes(["A"], ["A"])).status, STATUS_INELIGIBLE)

    def test_layered_requires_the_candidate_to_be_inside_the_box(self) -> None:
        rule = RULES["layered"]
        self.assertEqual(
            rule(make_seed(), self.probes(["B", "A"], ["A", "C"], box=("A",))).detail,
            "layer1_intersection_in_box",
        )
        # 共通集合が2件でも、最上位が一致し矩形内にあれば層2で拾う。
        self.assertEqual(
            rule(make_seed(), self.probes(["A", "B"], ["A", "B"], box=("A",))).detail,
            "layer2_top1_in_box",
        )
        # 矩形内に同名が1件しかなく、片方のクエリがそれを挙げている場合。
        self.assertEqual(
            rule(make_seed(), self.probes(["B", "A"], ["C", "D"], box=("A",))).detail,
            "layer3_unique_in_box",
        )
        # A と B が一致しても矩形の外なら採らない。
        self.assertEqual(
            rule(make_seed(), self.probes(["A"], ["A"], box=("Z",))).status, STATUS_AMBIGUOUS
        )

    def test_layered_strict_drops_the_weakest_layer(self) -> None:
        strict = RULES["layered_strict"]
        layered = RULES["layered"]
        only_box = self.probes(["B", "A"], ["C", "D"], box=("A",))
        self.assertEqual(layered(make_seed(), only_box).detail, "layer3_unique_in_box")
        self.assertEqual(strict(make_seed(), only_box).status, STATUS_AMBIGUOUS)
        both_agree = self.probes(["A"], ["A"], box=("A",))
        self.assertEqual(strict(make_seed(), both_agree).status, STATUS_MATCHED)

    def test_wide_recovery_needs_single_candidate_agreement(self) -> None:
        rule = RULES["layered_strict_wide"]
        # 狭い矩形の外だが、A と B が単一候補で一致し、広い矩形の中にある。
        probes = {
            PROBE_A: SearchResult(("A",), 200),
            PROBE_B: SearchResult(("A",), 200),
            PROBE_C: SearchResult((), 200),
            PROBE_C_WIDE: SearchResult(("A", "Z"), 200),
        }
        self.assertEqual(rule(make_seed(), probes).detail, "wide1_strict_in_wide_box")
        # 候補が複数あるなら救済しない（負例で誤マッチを出した緩い層を入れない）。
        probes[PROBE_A] = SearchResult(("A", "B"), 200)
        self.assertEqual(rule(make_seed(), probes).status, STATUS_AMBIGUOUS)
        # 広い矩形の外なら救済しない。
        probes[PROBE_A] = SearchResult(("A",), 200)
        probes[PROBE_C_WIDE] = SearchResult(("Z",), 200)
        self.assertEqual(rule(make_seed(), probes).status, STATUS_AMBIGUOUS)

    def test_high_false_match_rules_are_not_exportable(self) -> None:
        # 負例で 14.67% の誤マッチを出したルールを CSV 出力に選べてはいけない。
        self.assertNotIn("layered_wide", EXPORT_SAFE_RULES)
        self.assertNotIn("strict_unique", EXPORT_SAFE_RULES)
        self.assertNotIn("top1_agree", EXPORT_SAFE_RULES)
        self.assertIn("layered_strict", EXPORT_SAFE_RULES)
        self.assertLessEqual(EXPORT_SAFE_RULES, set(RULES))

    def test_http_error_is_not_counted_as_unmatched(self) -> None:
        probes = {
            PROBE_A: SearchResult((), 503, "unavailable"),
            PROBE_B: SearchResult(("A",), 200),
        }
        self.assertEqual(RULES["strict_unique"](make_seed(), probes).status, STATUS_API_ERROR)


class NameComparisonTest(unittest.TestCase):
    """正解検証の店名比較。ここが緩いと 99% は自動的に達成されてしまう。"""

    def test_category_words_are_not_erased(self) -> None:
        # 業態語を文字列中どこでも落とすと「カフェ」「居酒屋」が空になり、
        # その行は店名で一切判定できなくなる。末尾の支店語だけ落とす。
        self.assertEqual(normalize_for_comparison("カフェ"), "カフェ")
        self.assertEqual(normalize_for_comparison("居酒屋"), "居酒屋")
        self.assertEqual(normalize_for_comparison("ラーメン二郎三田本店"), "ラーメン二郎三田")

    def test_bare_chain_name_does_not_auto_pass(self) -> None:
        # 以前は包含関係だけで 0.85 を返しており、Overture に 2,741行ある
        # 「マクドナルド」がどの支店とも無条件で一致してしまっていた。
        self.assertLess(name_similarity("マクドナルド", "マクドナルド渋谷店"), 0.85)
        self.assertLess(name_similarity("マクドナルド渋谷店", "マクドナルド道玄坂店"), 0.7)

    def test_real_variants_still_match(self) -> None:
        self.assertGreater(name_similarity("百万石うどんこのみ小中店", "このみ百万石うどん 小中店"), 0.5)
        self.assertGreater(name_similarity("株式会社ドミノ・ピザ 渋谷店", "ドミノ・ピザ 渋谷店"), 0.9)
        # 実際に別店舗である例は落ちること。
        self.assertLess(name_similarity("栗雲丹", "海鮮料理 雲丹しゃぶしゃぶ 工藤"), 0.2)

    def test_chain_key_separates_branch_qualified_names(self) -> None:
        # 支店名が付いている行は名前が支店を特定しているので、別扱いでよい。
        self.assertNotEqual(chain_key("マクドナルド渋谷店"), chain_key("マクドナルド"))
        # 店名がチェーン名のままの行だけが同名多数として束ねられる。
        self.assertEqual(chain_key("マクドナルド"), chain_key("マクドナルド店"))
        self.assertNotEqual(chain_key("マクドナルド"), chain_key("モスバーガー"))




class BoxUniqueRuleTest(unittest.TestCase):
    """``rule_box_unique`` は「矩形内で一意」だけを根拠にする。

    合意ではなく一意性を見るルールなので、A と B が揃って間違えている場合でも
    矩形内に複数居れば確定しない、という性質を確かめる。
    """

    def probes(self, a, b, tight=(), wide=()) -> dict:
        return {
            PROBE_A: SearchResult(tuple(a), 200),
            PROBE_B: SearchResult(tuple(b), 200),
            PROBE_C_TIGHT: SearchResult(tuple(tight), 200),
            PROBE_C_WIDE: SearchResult(tuple(wide), 200),
        }

    def decide(self, **kwargs):
        return RULES["box_unique"](make_seed(), self.probes(**kwargs))

    def test_tight_box_unique_and_supported_matches(self) -> None:
        decision = self.decide(a=("A", "B"), b=("A", "C"), tight=("A",))
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.place_id, "A")
        self.assertEqual(decision.detail, "tight_unique_in_ab")

    def test_tight_box_unique_without_text_support_is_rejected(self) -> None:
        """矩形内で一意でも、店名クエリがその place を挙げていなければ別の店である。

        この裏取りを外すとラベル実測で精度が 99.9% から 5.8% へ落ちた。
        """

        decision = self.decide(a=("B",), b=("C",), tight=("A",))
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertIsNone(decision.place_id)

    def test_multiple_in_tight_box_falls_through_to_wide(self) -> None:
        decision = self.decide(a=("A", "B"), b=("A", "B"), tight=("A", "B"), wide=("A",))
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.detail, "wide_unique_in_ab")

    def test_agreement_alone_does_not_match(self) -> None:
        """A と B が完全一致していても、矩形内が一意でなければ確定させない。"""

        decision = self.decide(a=("A",), b=("A",), tight=("A", "B"), wide=("A", "B"))
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertEqual(decision.detail, "box_not_unique")

    def test_empty_boxes_report_absent(self) -> None:
        decision = self.decide(a=("A",), b=("A",), tight=(), wide=())
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertEqual(decision.geo, GEO_ABSENT)

    def test_registered_as_export_safe(self) -> None:
        self.assertIn("box_unique", RULES)
        self.assertIn("box_unique", EXPORT_SAFE_RULES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
