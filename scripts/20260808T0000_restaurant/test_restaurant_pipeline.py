"""ネットワーク・BigQueryなしで固定できる店提案パイプラインの業務ルール。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from datetime import date, datetime, timezone

import importlib

import duckdb

from entity_resolution import EntityResolver, SourceRecord
from google_place_matching import (
    TextSearchResult,
    build_box_payload,
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


class CountryCodeTest(unittest.TestCase):
    """#843 国は «取り込んだときの値» で決める。座標の矩形から断定しない。"""

    def test_seed_takes_country_from_the_canonical_source(self) -> None:
        records = [
            SourceRecord(
                "ifas", "i1", "対馬食堂", "長崎県対馬市厳原町1-1", 34.2, 129.29,
                country_code="JP",
            ),
            SourceRecord(
                "overture", "o1", "対馬食堂", "長崎県対馬市厳原町1-1", 34.2, 129.29,
                country_code="JP",
            ),
        ]
        seeds, _ = EntityResolver().resolve(records)
        self.assertEqual(1, len(seeds))
        self.assertEqual("JP", seeds[0].country_code)

    def test_seed_keeps_a_country_when_the_canonical_source_has_none(self) -> None:
        # 国を持たないソースが canonical になっても、持っているソースの値は消えない。
        records = [
            SourceRecord("overture", "o1", "無国籍亭", "東京都1-1", 35.0, 139.0),
            SourceRecord(
                "ifas", "i1", "無国籍亭", "東京都1-1", 35.0, 139.0, country_code="JP"
            ),
        ]
        seeds, _ = EntityResolver().resolve(records)
        self.assertEqual("JP", seeds[0].country_code)

    def test_existing_pg_country_comes_from_google_address_components(self) -> None:
        module = importlib.import_module("2_1_build_restaurant_source_records")
        self.assertEqual(
            "GE",
            module.country_from_components(
                '[{"longText":"Georgia","shortText":"GE","types":["country","political"]}]'
            ),
        )
        # 国が引けない / 壊れた値は «日本» に倒さず None にする。
        self.assertIsNone(module.country_from_components('[{"types":["locality"]}]'))
        self.assertIsNone(module.country_from_components("not json"))
        self.assertIsNone(module.country_from_components(None))


class OvertureJapanFilterTest(unittest.TestCase):
    """#843 日本の «矩形» は韓国と沿海地方を含む。国は country 列でしか決まらない。"""

    # 対馬(129.29E)・釜山(129.07E)・ウラジオストク(131.89E) は、どれも
    # 緯度20.0–46.5 / 経度122.0–154.0 の «日本の矩形» の中にある。
    ROWS = """
      SELECT * FROM (VALUES
        ('tsushima', 'JP', 129.29, 34.20),
        ('busan', 'KR', 129.07, 35.15),
        ('vladivostok', 'RU', 131.89, 43.12)
      ) AS t(id, country, lon, lat)
    """
    BBOX = "lon BETWEEN 122.0 AND 154.0 AND lat BETWEEN 20.0 AND 46.5"

    def test_bbox_alone_lets_korea_and_russia_through(self) -> None:
        rows = duckdb.connect().execute(
            f"SELECT id FROM ({self.ROWS}) WHERE {self.BBOX} ORDER BY id"
        ).fetchall()
        self.assertEqual([("busan",), ("tsushima",), ("vladivostok",)], rows)

    def test_country_filter_keeps_tsushima_and_drops_the_rest(self) -> None:
        rows = duckdb.connect().execute(
            f"SELECT id FROM ({self.ROWS}) WHERE country = 'JP' AND {self.BBOX}"
        ).fetchall()
        self.assertEqual([("tsushima",)], rows)

    def test_loader_filters_on_country_not_on_the_bbox(self) -> None:
        module = importlib.import_module("1_3_load_overture")
        self.assertEqual(
            "addresses[1].country = 'JP'", module.JAPAN_COUNTRY_PREDICATE
        )
        self.assertLessEqual(module.MAX_MISSING_COUNTRY_RATIO, 0.01)


class NormalizationTest(unittest.TestCase):
    def test_poc_l1_rules_are_reused(self) -> None:
        self.assertEqual(normalize_name_l1("株式会社 麺屋髙橋 本店"), "麺屋高橋")
        self.assertEqual(
            normalize_address("〒100-0001 東京都1丁目2番地3号"), "東京都1-2-3"
        )


class GooglePlaceMatchingTest(unittest.TestCase):
    def test_only_unique_in_tight_box_is_accepted(self) -> None:
        # ±25m の矩形に同名が1件、それを A と B が挙げていて、B は1件だけ。
        accepted = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult(("place-1",), 200),
            result_tight=TextSearchResult(("place-1",), 200),
            result_wide=TextSearchResult(("place-1",), 200),
            has_address=True,
        )
        self.assertEqual("place-1", accepted.matched_place_id)
        self.assertEqual("box_unique_strict", accepted.status)

        # 矩形に候補が無ければ、A と B が一致していても採らない。
        # locationBias は絞り込まないので、店が Google に無いとき両方が隣の店を返す。
        no_box = decide_match(
            TextSearchResult(("place-neighbour",), 200),
            TextSearchResult(("place-neighbour",), 200),
            result_tight=TextSearchResult((), 200),
            result_wide=TextSearchResult((), 200),
            has_address=True,
        )
        self.assertIsNone(no_box.matched_place_id)
        self.assertEqual("no_candidate_in_box", no_box.status)

        # 矩形に同名が複数あれば取り違えの余地がある。
        ambiguous_box = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult(("place-1",), 200),
            result_tight=TextSearchResult(("place-1", "place-2"), 200),
            result_wide=TextSearchResult(("place-1", "place-2"), 200),
            has_address=True,
        )
        self.assertEqual("box_not_unique", ambiguous_box.status)

        # 矩形が一意でも、A も B も挙げていなければ別の店である（実測で正解率 1.0%）。
        unsupported = decide_match(
            TextSearchResult(("place-other",), 200),
            TextSearchResult(("place-other",), 200),
            result_tight=TextSearchResult(("place-1",), 200),
            result_wide=TextSearchResult(("place-1",), 200),
            has_address=True,
        )
        self.assertEqual("box_not_unique", unsupported.status)

        # ±250m でしか拾えないものは採らない（②を 100% にするための条件）。
        wide_only = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult(("place-1",), 200),
            result_tight=TextSearchResult((), 200),
            result_wide=TextSearchResult(("place-1",), 200),
            has_address=True,
        )
        self.assertEqual("rejected_not_in_tight_box", wide_only.status)

        # 住所クエリが複数返す店名も採らない（同上）。
        noisy_address = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult(("place-1", "place-2"), 200),
            result_tight=TextSearchResult(("place-1",), 200),
            result_wide=TextSearchResult(("place-1",), 200),
            has_address=True,
        )
        self.assertEqual("rejected_address_query_ambiguous", noisy_address.status)

        missing_address = decide_match(
            TextSearchResult(("place-1",), 200),
            TextSearchResult((), None),
            result_tight=TextSearchResult(("place-1",), 200),
            result_wide=TextSearchResult(("place-1",), 200),
            has_address=False,
        )
        self.assertEqual("ineligible_missing_address", missing_address.status)

        api_error = decide_match(
            TextSearchResult((), 500),
            TextSearchResult((), 200),
            result_tight=TextSearchResult((), 200),
            result_wide=TextSearchResult((), 200),
            has_address=True,
        )
        self.assertEqual("api_error", api_error.status)

    def test_box_payload_cuts_outside_the_rectangle(self) -> None:
        """矩形は locationBias と違い、外を実際に切り落とす指定である。"""

        body = build_box_payload("山田屋", 35.0, 139.0, 25.0)
        self.assertIn("rectangle", body["locationRestriction"])
        self.assertNotIn("locationBias", body)
        self.assertEqual("places.id", "places.id")
        rectangle = body["locationRestriction"]["rectangle"]
        self.assertLess(rectangle["low"]["latitude"], 35.0)
        self.assertGreater(rectangle["high"]["latitude"], 35.0)

    def test_query_payloads(self) -> None:
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
            "restaurant_match_method": "box_unique_strict",
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


class FoodPermitTest(unittest.TestCase):
    """自治体台帳の取り込み。落とした行の数え上げまで含めて固定する。"""

    def _write(self, directory: Path, name: str, text: str) -> None:
        (directory / name).write_text(text, encoding="utf-8-sig")

    def test_columns_addresses_and_closures_are_handled(self) -> None:
        from collections import Counter

        from food_permits import iter_permit_rows

        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            # 「所在地郵便番号」を住所列と誤認すると、郵便番号を住所として読む。
            # 実測で大分県のファイル 18,732 行がこれで落ちた。
            self._write(
                directory,
                "大分県__permits.csv",
                "施設名称,所在地郵便番号,営業施設所在地,営業の種類\n"
                "山田屋,8700000,大分県大分市中央町1-1-1,飲食店営業\n",
            )
            # 東京23区は自分の区の中なので区名すら書かない。
            self._write(
                directory,
                "新宿区__permits.csv",
                "施設名称,所在地,営業の種類\n田中屋,新宿1-1-1,飲食店営業\n",
            )
            # 「営業ステータス」列に廃業と書く形式。渋谷区は 39,106 行中 22,122 行がこれ。
            self._write(
                directory,
                "渋谷区__permits.csv",
                "施設名称,施設所在地_連結表記,営業ステータス,営業の種類\n"
                "閉店屋,東京都渋谷区道玄坂1-1-1,廃業,飲食店営業\n"
                "営業中屋,東京都渋谷区道玄坂1-1-2,営業中,飲食店営業\n",
            )
            stats: Counter = Counter()
            rows = list(
                iter_permit_rows(
                    directory,
                    prefectures={"新宿区": "東京都", "大分市": "大分県"},
                    coordinates={"東京都渋谷区道玄坂1-1-2": (35.6, 139.7, "full")},
                    stats=stats,
                )
            )

        by_name = {row.name: row for row in rows}
        self.assertEqual({"山田屋", "田中屋", "営業中屋"}, set(by_name))
        # 郵便番号ではなく施設の住所を読んでいる
        self.assertEqual("大分県大分市中央町1-1-1", by_name["山田屋"].address)
        # 区名の無い住所に「東京都新宿区」が前置されている
        self.assertEqual("東京都新宿区新宿1-1-1", by_name["田中屋"].address)
        # 廃業はステータス列の値で落ちている
        self.assertEqual(1, stats["closed_by_status"])
        # ジオコーディング結果が付いた行と、付いていない行が数えられている
        self.assertEqual("geocoded:full", by_name["営業中屋"].coordinate_source)
        self.assertEqual(1, stats["has_coordinates"])
        self.assertEqual(2, stats["needs_geocoding"])

    def test_permit_source_ranks_below_ifas(self) -> None:
        """同じ店が両方にあるなら、台帳に座標が入っている IFAS を採る。"""

        from entity_resolution import SOURCE_PRIORITY

        self.assertLess(SOURCE_PRIORITY["ifas"], SOURCE_PRIORITY["food_permit"])
        self.assertLess(SOURCE_PRIORITY["overture"], SOURCE_PRIORITY["food_permit"])


if __name__ == "__main__":
    unittest.main()
