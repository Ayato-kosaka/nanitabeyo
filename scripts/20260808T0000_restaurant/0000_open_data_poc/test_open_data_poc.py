from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("open_data_poc.py")
SPEC = importlib.util.spec_from_file_location("open_data_poc", MODULE_PATH)
assert SPEC and SPEC.loader
poc = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = poc
SPEC.loader.exec_module(poc)


class NormalizationTest(unittest.TestCase):
    def test_normalizes_width_case_spaces_and_punctuation(self) -> None:
        self.assertEqual(poc.normalize_name(" Ｃａｆｅ・東京  "), "cafe東京")

    def test_l1_removes_legal_markers_suffixes_and_maps_variants(self) -> None:
        self.assertEqual(poc.normalize_name_l1("株式会社 髙﨑食堂 本店"), "高崎食堂")

    def test_normalizes_japanese_address_notation(self) -> None:
        self.assertEqual(poc.normalize_address("〒160-0023 東京都新宿区1丁目2番3号"), "東京都新宿区1-2-3")

    def test_trigram_similarity_prefers_close_spelling(self) -> None:
        self.assertGreater(
            poc.trigram_similarity("らーめん二郎", "ラーメン二郎"),
            poc.trigram_similarity("らーめん二郎", "東京食堂"),
        )
        self.assertEqual(poc.trigram_similarity("cat", "cats"), 0.5)

    def test_extracts_unique_jurisdiction_codes(self) -> None:
        source = "_i_n01000_str=x; _i_n13101_str=y; _i_n01000_str=z"
        self.assertEqual(poc.parse_jurisdiction_codes(source), ["01000", "13101"])

    def test_expiry_and_closure_rules(self) -> None:
        self.assertFalse(poc.is_active_ifas({poc.IFAS_CLOSED: "2026/01/01"}, date(2026, 8, 8)))
        self.assertFalse(poc.is_active_ifas({poc.IFAS_EXPIRY: "2026/08/07"}, date(2026, 8, 8)))
        self.assertTrue(poc.is_active_ifas({poc.IFAS_EXPIRY: "2026/08/08"}, date(2026, 8, 8)))


class MatchingTest(unittest.TestCase):
    @staticmethod
    def index(*candidates: object) -> object:
        return poc.SpatialCandidateIndex(candidates)

    def test_exact_name_within_radius_is_accepted(self) -> None:
        candidate = poc.Candidate("overture", "o1", "寿司・東京", 35.0, 139.0)
        match = poc.match_one("r1", "寿司 東京", 35.0001, 139.0001, [self.index(candidate)])
        self.assertEqual(match.method, "exact_name_nearby")
        self.assertEqual(match.source_id, "o1")
        self.assertFalse(match.ambiguous)

    def test_far_candidate_is_rejected(self) -> None:
        candidate = poc.Candidate("overture", "o1", "寿司東京", 35.01, 139.01)
        match = poc.match_one("r1", "寿司東京", 35.0, 139.0, [self.index(candidate)])
        self.assertEqual(match.method, "unmatched")

    def test_near_tied_candidates_are_ambiguous(self) -> None:
        candidates = (
            poc.Candidate("overture", "o1", "東京カフェ", 35.0, 139.0),
            poc.Candidate("ifas", "i1", "東京カフェ", 35.0008, 139.0),
        )
        match = poc.match_one("r1", "東京カフェ", 35.0004, 139.0, [self.index(*candidates)])
        self.assertTrue(match.ambiguous)
        self.assertEqual(match.method, "ambiguous")

    def test_cross_source_corroboration_is_not_ambiguous(self) -> None:
        candidates = (
            poc.Candidate("overture", "o1", "東京カフェ", 35.0, 139.0),
            poc.Candidate("ifas", "i1", "東京カフェ", 35.00001, 139.00001),
        )
        match = poc.match_one("r1", "東京カフェ", 35.0, 139.0, [self.index(*candidates)])
        self.assertFalse(match.ambiguous)

    def test_exact_source_overlap_is_a_conservative_lower_bound(self) -> None:
        left = [
            poc.Candidate("ifas", "i1", "東京カフェ", 35.0, 139.0),
            poc.Candidate("ifas", "i2", "別の店", 35.1, 139.1),
        ]
        right = [poc.Candidate("overture", "o1", "東京・カフェ", 35.0001, 139.0001)]
        metrics = poc.exact_source_overlap(left, right)
        self.assertEqual(metrics["matched_left"], 1)
        self.assertEqual(metrics["matched_left_percent"], 50.0)

    def test_reference_gate_requires_every_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.csv"
            reference.write_text(
                "id,name,latitude,longitude,google_place_id\n"
                "r1,東京カフェ,35.0,139.0,g1\n"
                "r2,大阪食堂,34.7,135.5,g2\n",
                encoding="utf-8",
            )
            candidates = {
                "overture": [poc.Candidate("overture", "o1", "東京カフェ", 35.0, 139.0)]
            }
            metrics = poc.match_reference(reference, candidates, root / "out")
            self.assertEqual(metrics["coverage_percent"], 50.0)
            self.assertFalse(metrics["acceptance_gate_100_percent"])
            self.assertTrue((root / "out" / "unmatched_reference.csv").exists())
            self.assertTrue((root / "out" / "unmatched_review_sample.csv").exists())
            sample = (root / "out" / "unmatched_review_sample.csv").read_text(encoding="utf-8-sig")
            self.assertIn("https://www.google.com/maps/place/?q=place_id:g2", sample)

    def test_reviewed_closed_and_matcher_failure_adjust_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.csv"
            reference.write_text(
                "id,name,latitude,longitude\n"
                "r1,東京カフェ,35.0,139.0\n"
                "r2,閉店,34.7,135.5\n"
                "r3,表記揺れ,34.8,135.6\n",
                encoding="utf-8",
            )
            reviewed = root / "reviewed.csv"
            reviewed.write_text(
                "id,classification\n"
                "r2,closed\n"
                "r3,matching_failure\n",
                encoding="utf-8",
            )
            metrics = poc.match_reference(
                reference,
                {"overture": [poc.Candidate("overture", "o1", "東京カフェ", 35.0, 139.0)]},
                root / "out",
                reviewed_unmatched_csv=reviewed,
            )
            self.assertEqual(metrics["closed_adjusted_coverage_percent"], 100.0)
            self.assertTrue(metrics["acceptance_gate_95_percent_excluding_closed"])

    def test_legacy_manifest_maps_municipality_columns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "legacy.csv").write_text(
                "許可番号,屋号,所在地,緯度,経度,業種\n1,旧食堂,東京都,35.0,139.0,飲食店営業\n",
                encoding="utf-8",
            )
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"sources": [{
                "name": "test-city", "path": "legacy.csv",
                "columns": {"id": "許可番号", "name": "屋号", "address": "所在地", "latitude": "緯度", "longitude": "経度"},
                "filters": {"business_type_column": "業種", "business_type_contains": ["飲食店"]},
            }]}, ensure_ascii=False), encoding="utf-8")
            metrics, candidates = poc.legacy_csv_metrics(manifest)
            self.assertEqual(metrics["candidates_with_coordinates"], 1)
            self.assertEqual(candidates[0].address, "東京都")

    def test_duplicate_cluster_metrics(self) -> None:
        metrics = poc.duplicate_cluster_metrics([
            poc.Candidate("overture", "1", "株式会社 東京食堂", 35.0, 139.0),
            poc.Candidate("overture", "2", "東京食堂", 35.0001, 139.0001),
            poc.Candidate("overture", "3", "大阪食堂", 34.7, 135.5),
        ])
        self.assertEqual(metrics["unique_clusters"], 2)

    def test_duplicate_cluster_uses_japan_safe_longitude_cells(self) -> None:
        metrics = poc.duplicate_cluster_metrics([
            poc.Candidate("overture", "1", "北の食堂", 45.0, 140.00065),
            poc.Candidate("overture", "2", "北の食堂", 45.0, 140.00125),
        ])
        self.assertEqual(metrics["unique_clusters"], 1)


if __name__ == "__main__":
    unittest.main()
