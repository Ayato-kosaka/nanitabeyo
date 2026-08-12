"""ネットワーク・BigQueryなしで固定できる店提案パイプラインの業務ルール。"""

from __future__ import annotations

import unittest
from datetime import date, datetime, timezone

from entity_resolution import EntityResolver, SourceRecord
from google_place_matching import (
    TextSearchResult,
    build_query_payloads,
    decide_match,
)
from normalization import build_dish_media_id, normalize_address, normalize_name_l1
from social_media_input import normalize_input_row


class EntityResolutionTest(unittest.TestCase):
    def test_source_records_are_merged_into_one_seed(self) -> None:
        records = [
            SourceRecord(
                "overture", "o1", "麺屋 髙橋", "東京都千代田区1丁目2番3号", 35.0, 139.0
            ),
            SourceRecord(
                "ifas", "i1", "麺屋高橋 本店", "東京都千代田区1-2-3", 35.0001, 139.0001
            ),
        ]
        seeds, links = EntityResolver().resolve(records)
        self.assertEqual(1, len(seeds))
        self.assertEqual({"overture", "ifas"}, set(seeds[0].source_names))
        self.assertEqual(2, len(links))

    def test_different_existing_google_ids_never_merge(self) -> None:
        records = [
            SourceRecord(
                "existing_pg",
                "r1",
                "同名店",
                "東京都1-1",
                35.0,
                139.0,
                google_place_id="place-a",
            ),
            SourceRecord(
                "existing_pg",
                "r2",
                "同名店",
                "東京都1-1",
                35.0,
                139.0,
                google_place_id="place-b",
            ),
        ]
        seeds, _ = EntityResolver().resolve(records)
        self.assertEqual(2, len(seeds))

    def test_osm_canonical_origin_is_not_hidden_by_ifas_link(self) -> None:
        records = [
            SourceRecord("osm", "o1", "喫茶テスト", "東京都1-1", 35.0, 139.0),
            SourceRecord("ifas", "i1", "喫茶テスト", "東京都1-1", 35.0, 139.0),
        ]
        seeds, _ = EntityResolver().resolve(records)
        self.assertEqual(1, len(seeds))
        self.assertEqual("osm_only", seeds[0].seed_origin())

    def test_existing_pg_origin_is_preserved_with_open_data_links(self) -> None:
        records = [
            SourceRecord("existing_pg", "r1", "既存店", "東京都1-1", 35.0, 139.0),
            SourceRecord("ifas", "i1", "既存店", "東京都1-1", 35.0, 139.0),
        ]
        seeds, _ = EntityResolver().resolve(records)
        self.assertEqual("existing_pg_carry_forward", seeds[0].seed_origin())


class NormalizationTest(unittest.TestCase):
    def test_poc_l1_rules_are_reused(self) -> None:
        self.assertEqual(normalize_name_l1("株式会社 麺屋髙橋 本店"), "麺屋高橋")
        self.assertEqual(
            normalize_address("〒100-0001 東京都1丁目2番地3号"), "東京都1-2-3"
        )


class GooglePlaceMatchingTest(unittest.TestCase):
    def test_only_double_unique_agreement_is_accepted(self) -> None:
        accepted = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult(("place-1",), 200),
            has_address=True,
        )
        self.assertEqual("place-1", accepted.matched_place_id)
        self.assertEqual("double_query_agree", accepted.status)

        for a, b, expected in (
            (("p1", "p2"), ("p1",), "ambiguous"),
            (("p1",), ("p2",), "query_disagreement"),
            ((), ("p1",), "unmatched"),
        ):
            with self.subTest(expected=expected):
                decision = decide_match(
                    TextSearchResult(a, 200),
                    TextSearchResult(b, 200),
                    has_address=True,
                )
                self.assertIsNone(decision.matched_place_id)
                self.assertEqual(expected, decision.status)

    def test_missing_address_and_api_error_are_not_accepted(self) -> None:
        missing_address = decide_match(
            TextSearchResult(("p",), 200),
            TextSearchResult(("p",), 200),
            has_address=False,
        )
        self.assertEqual("ineligible_missing_address", missing_address.status)
        api_error = decide_match(
            TextSearchResult((), 429),
            TextSearchResult(("p",), 200),
            has_address=True,
        )
        self.assertEqual("api_error", api_error.status)

    def test_query_a_has_bias_and_query_b_has_address_without_bias(self) -> None:
        query_a, query_b, body_a, body_b = build_query_payloads(
            "店名", "東京都1-2-3", 35.0, 139.0
        )
        self.assertEqual("店名", query_a)
        self.assertEqual("店名 東京都1-2-3", query_b)
        self.assertEqual(150.0, body_a["locationBias"]["circle"]["radius"])
        self.assertNotIn("locationBias", body_b)


class SocialMediaInputTest(unittest.TestCase):
    def valid_row(self) -> dict[str, object]:
        return {
            "provider": "instagram",
            "external_content_id": "abc123",
            "canonical_url": "https://www.instagram.com/p/abc123/",
            "embed_html": '<blockquote class="instagram-media"></blockquote>',
            "media_type": "image",
            "google_place_id": "place-1",
            "restaurant_match_method": "double_query_agree",
            "restaurant_match_confidence": "0.99",
            "category_id": "Q123",
            "category_match_method": "manual",
            "category_confidence": "0.95",
            "availability_status": "available",
            "rights_basis": "official_oembed",
            "terms_version": "2026-08-12",
        }

    def test_valid_input_is_normalized_and_id_is_category_independent(self) -> None:
        observed_at = datetime(2026, 8, 12, tzinfo=timezone.utc)
        row = normalize_input_row(
            self.valid_row(),
            run_id="run-1",
            observed_date=date(2026, 8, 12),
            observed_at=observed_at,
        )
        self.assertEqual("instagram", row["provider"])
        self.assertEqual(
            build_dish_media_id("instagram", "abc123"), row["dish_media_id"]
        )
        changed = self.valid_row()
        changed["category_id"] = "Q999"
        second = normalize_input_row(
            changed, run_id="run-2", observed_date=date(2026, 8, 13)
        )
        self.assertEqual(row["dish_media_id"], second["dish_media_id"])

    def test_provider_host_rights_and_available_keys_are_enforced(self) -> None:
        invalid_host = self.valid_row()
        invalid_host["canonical_url"] = "https://evil.example/post/1"
        with self.assertRaisesRegex(ValueError, "URL host"):
            normalize_input_row(
                invalid_host, run_id="run", observed_date=date(2026, 8, 12)
            )

        missing_category = self.valid_row()
        missing_category["category_id"] = ""
        with self.assertRaisesRegex(ValueError, "必須項目"):
            normalize_input_row(
                missing_category, run_id="run", observed_date=date(2026, 8, 12)
            )

        missing_embed = self.valid_row()
        missing_embed["embed_html"] = ""
        with self.assertRaisesRegex(ValueError, "必須項目"):
            normalize_input_row(
                missing_embed, run_id="run", observed_date=date(2026, 8, 12)
            )

        insecure_thumbnail = self.valid_row()
        insecure_thumbnail["thumbnail_url"] = "http://cdn.example.test/thumbnail.jpg"
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            normalize_input_row(
                insecure_thumbnail, run_id="run", observed_date=date(2026, 8, 12)
            )


if __name__ == "__main__":
    unittest.main()
