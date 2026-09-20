#!/usr/bin/env python3
"""#1947 «溜まっていく表を run をまたいで読めない» を 1 箇所の判定に寄せて固定する。

2026-09-20、`5_1` が `--raw-run-id` 完全一致でしか収集 run を絞れず、**複数 run に
またがって溜まった未 resolve 212,301 件を 1 回で掃けなかった**。同じ形が «収集や巡回の
成果を読む» 入口に横並びであったので、CLAUDE.md の «直したら同じ形を全部探して一括で
直す» に従い、全部を当たり直して判定した。

| script | 読む表 | 判定 |
| --- | --- | --- |
| `5_1` | `sns_post_raw` | **当てはまる → 直した**（212,301 件が滞留） |
| `4_1 --crawl-run-id` | `sns_store_site_ig` | **当てはまる → 直した**（巡回 6 run に分かれた） |
| `4_11` / `4_13` / `4_14` | `sns_post_raw` | **当てはまる → 直した**（backfill は run をまたぐ） |
| `9_1 --resolved-run-ids` | `sns_post_resolved` | 既に `all` を持つ（#1273 で対応済み） |
| `4_2 --account-run-ids` | `sns_source_account` | 既に複数指定できる |
| `4_18 --source-run-id` | `sns_post_raw` | 既に «未指定なら全 run»（`@x IS NULL OR run_id = @x`） |
| `7_2_report_funnel` | 各表 | **当てはまらない。** «1 run の内訳» を出す道具で、混ぜると意味が壊れる |
| `restaurant_catalog` を読む全て | — | **当てはまらない。** run_id が «スナップショットそのもの»。 |
|  |  | 緩めると別時点のデータが混ざる（`3_x` / `7_4` / `9_2` / `pg_sync_common`） |

**未判定を «当てはまらない» と書かない。** 上の «当てはまらない» は理由つきで残す。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402

# 当てはまると判定し、共通 helper へ寄せた script
SHARES_THE_JUDGEMENT = (
    "5_1_apply_resolve.py",
    "4_1_discover_sns_accounts.py",
    "4_11_backfill_post_area.py",
    "4_13_backfill_account_area.py",
    "4_14_fetch_missing_captions.py",
)

# 当てはまらないと判定したもの（理由は module docstring）。空にしてはいけない。
DELIBERATELY_SINGLE_RUN = (
    "7_2_report_funnel.py",
    "7_4_measure_neighborhood_313.py",
    "9_2_sync_sns_dish_media.py",
    "pg_sync_common.py",
)


class TheJudgementLivesInOnePlaceTest(unittest.TestCase):
    def test_all_means_no_restriction(self) -> None:
        self.assertEqual("TRUE", common_sns.run_id_filter_sql(
            "r.run_id", "@rid", common_sns.RUN_ID_ALL))

    def test_a_pattern_becomes_like(self) -> None:
        self.assertEqual("r.run_id LIKE @rid", common_sns.run_id_filter_sql(
            "r.run_id", "@rid", "sns-2026-09-%"))

    def test_a_plain_value_is_still_an_exact_match(self) -> None:
        """既存の «1 run だけ» の使い方を壊さないこと。ここが退行すると静かに全 run を読む。"""
        self.assertEqual("r.run_id = @rid", common_sns.run_id_filter_sql(
            "r.run_id", "@rid", "sns-2026-09-20-targeted22"))

    def test_none_is_an_exact_match_too(self) -> None:
        self.assertEqual("r.run_id = @rid", common_sns.run_id_filter_sql(
            "r.run_id", "@rid", None))

    def test_the_help_escapes_the_percent_for_argparse(self) -> None:
        """argparse は help を %-フォーマットに掛ける。生の % を書くと --help が落ちる。"""
        help_text = common_sns.run_id_arg_help("対象の run_id")
        self.assertIn("%%", help_text)
        self.assertNotIn("%%%", help_text)


class NobodyCopiesTheJudgementTest(unittest.TestCase):
    def test_the_fixed_scripts_call_the_shared_helper(self) -> None:
        for name in SHARES_THE_JUDGEMENT:
            with self.subTest(script=name):
                source = (HERE / name).read_text(encoding="utf-8")
                self.assertIn("run_id_filter_sql", source,
                              f"{name} が判定を共通 helper から呼んでいない")

    def test_they_do_not_reimplement_the_branch(self) -> None:
        """«ALL なら TRUE» を各 script へ写経し直していないこと（ずれるのは時間の問題）。"""
        for name in SHARES_THE_JUDGEMENT:
            with self.subTest(script=name):
                source = (HERE / name).read_text(encoding="utf-8")
                self.assertNotIn('raw_run_filter = "TRUE"', source)

    def test_the_not_applicable_list_is_not_quietly_emptied(self) -> None:
        """«当てはまらない» と判定したものを消すと、次の人がまた同じ調査をする。"""
        self.assertTrue(DELIBERATELY_SINGLE_RUN)
        for name in DELIBERATELY_SINGLE_RUN:
            with self.subTest(script=name):
                self.assertTrue((HERE / name).exists(), f"{name} が存在しない")


if __name__ == "__main__":
    unittest.main()
