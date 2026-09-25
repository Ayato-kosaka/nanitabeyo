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
| `4_11` / `4_13` / `4_14` の **UPDATE 側** | `sns_post_raw` | **当てはまる → 2026-09-25 に直した** |
| `7_2_report_funnel` | 各表 | **当てはまらない。** «1 run の内訳» を出す道具で、混ぜると意味が壊れる |
| `restaurant_catalog` を読む全て | — | **当てはまらない。** run_id が «スナップショットそのもの»。 |
|  |  | 緩めると別時点のデータが混ざる（`3_x` / `7_4` / `9_2` / `pg_sync_common`） |

2026-09-25 の追記。上の表で «直した» と書いた `4_11` / `4_13` / `4_14` は、**SELECT 側だけ**
だった。同じ script の UPDATE は `WHERE t.run_id = @rid` のままで、`--run-id ALL` を渡すと
**対象は全 run から選ばれるのにどの行にも当たらない**（`'ALL'` に一致する行は無い）。
しかも完了ログは «投げた件数»（`len(chunk)`）を足していたので、**1 行も書けていないのに
「書き戻し N 件」と出る**。読む側だけ直して書く側を残すと、この形になる。
以後、**同じ run_id を使う SELECT と DML は同じ helper を通す**ことをここで固定し、
`execute_dml_retrying` は «影響行数» を返して、完了件数はそれで数える。

**未判定を «当てはまらない» と書かない。** 上の «当てはまらない» は理由つきで残す。
"""
from __future__ import annotations

import re
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


class TheWriteSideUsesTheSameScope(unittest.TestCase):
    """#1947 読む側だけ直して書く側を残さない（2026-09-25）。"""

    # run_id_filter_sql を使う script で、**同じ param を生比較してよい**もの。理由を必ず書く。
    RAW_COMPARISON_IS_CORRECT = {
        # 別の表（restaurant_catalog）の «スナップショットを指す run_id»。
        # 緩めると別時点のカタログが混ざる（module docstring の最終行と同じ判定）。
        ("4_1_discover_sns_accounts.py", "@crid"),
        # この run 自身の id で «今回自分が書いた行» だけを消す DELETE。常に単一の値。
        ("4_1_discover_sns_accounts.py", "@rid"),
    }

    @staticmethod
    def _params_passed_to_helper(source: str) -> set[str]:
        return set(re.findall(r'run_id_filter_sql\(\s*"[^"]+"\s*,\s*"(@\w+)"', source))

    def test_no_script_compares_the_same_param_raw(self) -> None:
        bad: list[str] = []
        for path in sorted(HERE.glob("[0-9]*.py")):
            source = path.read_text(encoding="utf-8")
            for param in self._params_passed_to_helper(source):
                if (path.name, param) in self.RAW_COMPARISON_IS_CORRECT:
                    continue
                if re.search(r"run_id\s*=\s*" + re.escape(param) + r"\b", source):
                    bad.append(f"{path.name}: run_id = {param}")
        self.assertEqual(
            bad, [],
            "同じ run_id を SELECT では helper 経由、DML では生比較で絞っている。"
            "helper を通すか、正しい理由を書いて RAW_COMPARISON_IS_CORRECT へ入れること:\n  "
            + "\n  ".join(bad))

    def test_backfills_count_what_actually_changed(self) -> None:
        """完了件数は «投げた件数» ではなく «書き換わった行数» で数えること。"""
        for name in ("4_11_backfill_post_area.py", "4_13_backfill_account_area.py",
                     "4_14_fetch_missing_captions.py"):
            with self.subTest(script=name):
                body = "\n".join(
                    ln for ln in (HERE / name).read_text(encoding="utf-8").splitlines()
                    if not ln.lstrip().startswith("#"))
                self.assertNotIn("done += len(", body)
                self.assertNotIn("ndone += len(", body)

    def test_the_retrying_helper_returns_affected_rows(self) -> None:
        """`execute_dml_retrying` が rows ではなく影響行数を返すこと（数える根拠）。"""
        src = (HERE / "pipeline_common.py").read_text(encoding="utf-8")
        body = src[src.index("def execute_dml_retrying("):][:2000]
        self.assertIn("self.execute_dml(", body)
        self.assertNotIn("return self.execute(sql, parameters)", body)


if __name__ == "__main__":
    unittest.main()
