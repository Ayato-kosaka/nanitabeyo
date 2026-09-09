"""#1815 «一度 IG コールを使った handle を、二度呼ばない» を固定する。

2026-09-09 実測: 6 時間あたりに処理できるアカウントが 943 → 906 → 957 → 741 → 567 →
447 → 341 と単調に落ちた。在庫（未収集 store_branch 36,463 件）は尽きていない。
原因は «投稿が 1 件も返らない handle»（IG code 110 / business でない / 非公開）が
sns_post_raw に何も残さないことで、«投稿がある handle を除く» 除外に永久に引っかからず、
ORDER BY handle の先頭に居座り続けていたこと。run を重ねるほど «新しい handle へ届く前に
使い切るコール数» が増える。

欠陥を 1 文で言うと「**呼んだ事実ではなく、採れた事実だけを記録していた**」。
台帳（sns_account_attempt）へ呼んだ事実を残し、選択がそれを見ることで固定する。
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("collect_account_posts",
                                               HERE / "4_2_collect_account_posts.py")
collect = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collect)


class _FakePipeline:
    def __init__(self) -> None:
        self.sql = ""

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql, params=None):
        self.sql = sql
        return []


def _sql(scope: str) -> str:
    pipeline = _FakePipeline()
    collect._read_accounts(pipeline, ["acc-run"], "store_branch", 100,
                           output_run_id="out-run", skip_collected_scope=scope)
    return " ".join(pipeline.sql.split())


class AttemptLedgerTest(unittest.TestCase):
    def test_scope_any_excludes_already_called_handles(self) -> None:
        """scope=any は «採れた handle» だけでなく «呼んだ handle» も除く。"""
        sql = _sql("any")
        self.assertIn("sns_account_attempt", sql)
        self.assertIn("handle NOT IN", sql)

    def test_scope_run_is_unchanged(self) -> None:
        """既定（run 内で前進）の意味は変えない。台帳を見に行かない。"""
        self.assertNotIn("sns_account_attempt", _sql("run"))

    def test_ledger_row_is_written_even_with_zero_posts(self) -> None:
        """投稿 0 件でも台帳に 1 行残す。残さないと «呼んだのに記録が無い» が再発する。"""
        source = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")
        body = source.split("for acc in accounts:", 1)[1]
        append = body.split("attempts.append(", 1)[1]
        # append は «投稿を 1 件も採れなかった» 分岐の外、ループ本体の直下にある
        self.assertIn('"post_count": n', append)
        self.assertNotIn("if n:", body.split("attempts.append(", 1)[0].rsplit("\n", 3)[-1])

    def test_ledger_table_is_created_before_selection(self) -> None:
        """台帳が無い状態で選択 SQL を撃つと落ちるので、run の頭で必ず用意する。"""
        source = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS", source)
        main_body = source.split("def main()", 1)[1]
        self.assertLess(main_body.index("_ensure_attempt_table(pipeline)"),
                        main_body.index("_read_accounts("))


if __name__ == "__main__":
    unittest.main()
