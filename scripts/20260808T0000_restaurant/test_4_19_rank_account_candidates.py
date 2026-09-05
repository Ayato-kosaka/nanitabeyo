"""#1273 «1 コールあたりの期待店数» で未収集ハンドルを並べる規則を固定する。

守りたいのは 4 つ。

1. **段は «ハンドル文字列だけ» で決まる**（IG API を 1 回も呼ばずに決まらないと順番に使えない）
2. **料理語に料理名（ramen / sushi）を混ぜない。** 混ぜると店アカウントが上位を占め、
   取れ高の低い側へ順番を明け渡す（実測 0.216 店/コール 対 18.6）
3. **係数を焼き付けない。** score は収集済みハンドルの実測から毎回作り直す
4. **未収集ハンドルの実績（常に 0）を較正へ混ぜない**

ネットワークにも BigQuery にも触らない。
"""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path

try:  # noqa: SIM105
    import google.cloud.bigquery  # noqa: F401
except Exception:  # noqa: BLE001 - 本物が無い環境でも純関数のテストは回す
    _bq = types.ModuleType("google.cloud.bigquery")
    for _n in ("Client", "ScalarQueryParameter", "ArrayQueryParameter", "QueryJobConfig",
               "LoadJobConfig", "ParquetOptions", "SchemaField", "Table"):
        setattr(_bq, _n, type(_n, (), {}))
    _bq.WriteDisposition = types.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")
    _bq.SourceFormat = types.SimpleNamespace(NEWLINE_DELIMITED_JSON="NDJSON", PARQUET="PARQUET")
    _google = sys.modules.setdefault("google", types.ModuleType("google"))
    _cloud = sys.modules.setdefault("google.cloud", types.ModuleType("google.cloud"))
    setattr(_google, "cloud", _cloud)
    setattr(_cloud, "bigquery", _bq)
    sys.modules["google.cloud.bigquery"] = _bq

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ranker = _load(HERE / "4_19_rank_account_candidates.py", "rank_account_candidates")

import re  # noqa: E402

FOOD_RE = re.compile(ranker._token_regex(ranker.FOOD_TOKENS))
REGION_RE = re.compile(ranker._token_regex(ranker.REGION_TOKENS))


def handle_row(handle: str, *, seed: str | None = None, collected: bool = False,
               posts: int = 0, delivered: int = 0) -> dict:
    """`feature_sql` が返す 1 行と同じ形を、同じ語彙から組み立てる。

    **判定の写経を避ける**ため、`has_food_token` / `region_token` は
    script が公開している語彙（`FOOD_TOKENS` / `REGION_TOKENS`）から作る。
    """
    return {
        "handle": handle,
        "discovery_methods": [],
        "seed_place_id": seed,
        "store_attributed": seed is not None,
        "has_food_token": bool(FOOD_RE.search(handle)),
        "region_token": (REGION_RE.search(handle).group(0) if REGION_RE.search(handle) else None),
        "mention_posters": 0,
        "collected": collected,
        "observed_posts": posts,
        "delivered_stores": delivered,
    }


class TierTest(unittest.TestCase):
    def test_regional_gourmet_handle_is_top_tier(self):
        for handle in ("sapporo_gourmet", "fukuoka.meshi", "niigata_lunch2024",
                       "kumamoto_tabearuki"):
            self.assertEqual(ranker.tier_of(handle_row(handle)), "A_food_region", handle)

    def test_food_only_and_region_only_split(self):
        self.assertEqual(ranker.tier_of(handle_row("tokyo_ramen_ya")), "C_region")
        self.assertEqual(ranker.tier_of(handle_row("daily_gourmet_life")), "B_food")

    def test_store_account_without_tokens_is_below_region(self):
        """店アカウントは «店が確定する» が 1 店しか出さない。段は料理語/地域語より下。"""
        row = handle_row("menya_ajigen", seed="ChIJxxxx")
        self.assertEqual(ranker.tier_of(row), "D_store_attributed")

    def test_dish_names_are_not_food_tokens(self):
        """料理名を FOOD_TOKENS に足さない（足すと店アカウントが A/B 段を占拠する）。"""
        for dish in ("ramen", "sushi", "yakiniku", "izakaya", "curry", "soba", "udon"):
            self.assertNotIn(dish, ranker.FOOD_TOKENS, dish)

    def test_longer_token_wins_in_alternation(self):
        """`food` が `foodie` を先に食べると語の切り分けが変わる。長い順に並べること。"""
        self.assertEqual(FOOD_RE.search("osaka_foodie").group(0), "foodie")


class CalibrationTest(unittest.TestCase):
    def test_rates_come_from_collected_rows_only(self):
        rows = [
            handle_row("sapporo_gourmet", collected=True, posts=80, delivered=40),
            handle_row("hakata_meshi", collected=True, posts=60, delivered=20),
            # 未収集は実績 0。分母にも分子にも入れてはいけない。
            handle_row("sendai_gourmet"),
            handle_row("kobe_lunch"),
        ]
        stats = ranker.calibrate(rows)["A_food_region"]
        self.assertEqual(stats["collected"], 2)
        self.assertEqual(stats["uncollected"], 2)
        self.assertAlmostEqual(stats["delivered_stores_per_call"], 30.0)
        self.assertAlmostEqual(stats["expected_stores"], 60.0)

    def test_metric_is_delivered_stores_not_matched(self):
        """分子は配信カタログの異なり店。`matched` で数えると店アカウント段を 2.5 倍過小評価する。

        （2026-09-05 実測: D 段は matched 0.216 に対し配信ベース 0.550）
        """
        row = handle_row("sapporo_gourmet", collected=True, posts=10, delivered=7)
        self.assertNotIn("observed_stores", row)
        self.assertEqual(row["delivered_stores"], 7)
        self.assertAlmostEqual(
            ranker.calibrate([row])["A_food_region"]["delivered_stores_per_call"], 7.0)

    def test_tier_with_no_collected_handle_scores_zero_not_crash(self):
        stats = ranker.calibrate([handle_row("nagoya_gourmet")])["A_food_region"]
        self.assertEqual(stats["delivered_stores_per_call"], 0.0)


if __name__ == "__main__":
    unittest.main()
