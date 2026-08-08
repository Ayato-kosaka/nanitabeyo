from __future__ import annotations

import importlib.util
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
            poc.Candidate("ifas", "i1", "東京カフェ", 35.00001, 139.00001),
        )
        match = poc.match_one("r1", "東京カフェ", 35.0, 139.0, [self.index(*candidates)])
        self.assertTrue(match.ambiguous)
        self.assertEqual(match.method, "ambiguous")

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


if __name__ == "__main__":
    unittest.main()

