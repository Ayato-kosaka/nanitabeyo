#!/usr/bin/env python3
"""ネットワークなしで、課金ガード・住所クエリ組立・判定ルールを固定する。"""

from __future__ import annotations

import unittest

from free_places import ALLOWED_PLACE_KEYS, FIELD_MASK, BillingGuardError, SearchResult, extract_place_ids
from matching import (
    EXPORT_SAFE_RULES,
    GEO_ABSENT,
    GEO_CONFIRMED,
    GEO_INCONCLUSIVE,
    PROBE_A,
    PROBE_B,
    PROBE_C,
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
from seeds import (
    Seed,
    body_nearby,
    body_query_a,
    body_query_b,
    body_query_c,
    build_address_query,
    format_postcode,
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

    def test_address_query_prefers_prefecture_then_postcode(self) -> None:
        self.assertEqual(
            build_address_query("東京都中央区日本橋1-1", "1030021"),
            ("〒103-0021 東京都中央区日本橋1-1", "prefecture_and_postcode"),
        )
        self.assertEqual(build_address_query("東京都中央区日本橋1-1", None), ("東京都中央区日本橋1-1", "prefecture_only"))
        self.assertEqual(build_address_query("徳延758-1", "2540902"), ("〒254-0902 徳延758-1", "postcode_and_partial"))
        self.assertEqual(build_address_query("", "2540902"), ("〒254-0902", "postcode_only"))
        self.assertEqual(build_address_query(None, None), ("", "none"))

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
