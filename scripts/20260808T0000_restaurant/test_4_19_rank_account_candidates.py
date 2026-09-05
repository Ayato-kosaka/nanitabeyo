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
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

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
               posts: int = 0, stores: int = 0) -> dict:
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
        "region_token": (REGION_RE.search(handle).group(1) if REGION_RE.search(handle) else None),
        "mention_posters": 0,
        "collected": collected,
        "observed_posts": posts,
        "observed_stores": stores,
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

    def test_tokens_need_a_word_boundary(self):
        """部分文字列で当てない（2026-09-05: A 段 273 件のうち 71 件＝26% が誤爆していた）。"""
        for handle in ("nationaltheatre_tokyo", "aichi_creative", "sumai_yokohama",
                       "mariakoishikawa", "osaka_meat", "great_sapporo", "sweat_tokyo"):
            self.assertIsNone(FOOD_RE.search(handle), handle)

    def test_word_boundary_keeps_real_food_words(self):
        for handle in ("sapporo_gourmet", "fukuoka.meshi", "niigata_lunch2024",
                       "tokyo_eat", "osaka_foodie", "kobe_umai"):
            self.assertIsNotNone(FOOD_RE.search(handle), handle)

    def test_region_extract_returns_the_token_only(self):
        """`REGEXP_EXTRACT` は捕捉グループ 1 を返す。境界の文字を混ぜないこと。"""
        self.assertEqual(REGION_RE.search("sapporo_gourmet").group(1), "sapporo")
        self.assertEqual(REGION_RE.search("gourmet_fukuoka").group(1), "fukuoka")

    def test_longer_token_wins_in_alternation(self):
        """`food` が `foodie` を先に食べると語の切り分けが変わる。長い順に並べること。"""
        self.assertEqual(FOOD_RE.search("osaka_foodie").group(1), "foodie")


class CalibrationTest(unittest.TestCase):
    def test_rates_come_from_collected_rows_only(self):
        rows = [
            handle_row("sapporo_gourmet", collected=True, posts=80, stores=40),
            handle_row("hakata_meshi", collected=True, posts=60, stores=20),
            # 未収集は実績 0。分母にも分子にも入れてはいけない。
            handle_row("sendai_gourmet"),
            handle_row("kobe_lunch"),
        ]
        stats = ranker.calibrate(rows)["A_food_region"]
        self.assertEqual(stats["collected"], 2)
        self.assertEqual(stats["uncollected"], 2)
        self.assertAlmostEqual(stats["stores_per_call"], 30.0)
        self.assertAlmostEqual(stats["expected_stores"], 60.0)

    def test_tier_with_no_collected_handle_scores_zero_not_crash(self):
        stats = ranker.calibrate([handle_row("nagoya_gourmet")])["A_food_region"]
        self.assertEqual(stats["stores_per_call"], 0.0)


if __name__ == "__main__":
    unittest.main()
