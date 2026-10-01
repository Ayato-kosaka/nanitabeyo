"""#1947 «取りに行ったが本文が無かった» を忘れない。

2026-09-27 に実測した欠陥。`4_14` の対象条件は «caption が空» だけで、`random.shuffle` して
`--limit` で切るので、**一度取って空だった投稿が毎ラウンドまた引かれる**。成功だけが
`sns_caption_backfilled` に残り（キャプションが入って対象から外れる）、空は何も残らないので
永久に対象のままになる。

実測: 対象プール（`--only-with-seed --max-per-store 20`）は **60,589 投稿**。
ラウンド 23〜34 の «空» の合計だけで **約 30,000**。レート制限のある予算の半分近くを
«もう空だと分かっている投稿» に使っていた。«本文が取れた割合» が 54〜57% → 40.8〜43.9% へ
下がったのも、間隔ではなくこれで説明が付く（間隔を 30 分 / 2h24m / 4h22m と変えても
42.1% / 40.8% / 43.9% で相関しなかった）。

⚠️ **この試験が守るのは «記録する» ことだけである。** «空は二度と取れない» は**まだ未実測**なので、
除外は `--skip-known-empty` の明示指定でだけ効く（`4_23` が `no_handle` を 0/325 と
測り切ってから終端にしたのと同じ順序）。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "4_14_fetch_missing_captions.py"

_spec = importlib.util.spec_from_file_location("m414attempt", SOURCE)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)
SRC = SOURCE.read_text(encoding="utf-8")


class _StubPipeline:
    def table(self, name: str) -> str:
        return f"proj.ds.{name}"


def _sql(**kw) -> str:
    return m._select_sql(_StubPipeline(), True, 20, False, False, "ALL", **kw)


class EveryOutcomeIsRecorded(unittest.TestCase):
    def test_the_ledger_keeps_empty_and_error_too(self) -> None:
        self.assertIn("outcome      STRING NOT NULL", m.CREATE_ATTEMPT_SQL)
        for kind in ("'ok'", "'empty'", "'error'"):
            self.assertIn(kind, SRC, f"{kind} を記録していない")

    def test_the_worker_enqueues_before_branching(self) -> None:
        """成功の枝の中だけで積むと、空のラウンドが 1 件も残らない。"""
        body = SRC[SRC.index("def work("):SRC.index("def flush_attempts(")]
        self.assertLess(body.index("attempts.put("), body.index('if status == 200:'))

    def test_the_flush_is_not_nested_in_the_write_back(self) -> None:
        """`flush()`（本文の書き戻し）と独立に呼ばれること。"""
        self.assertIn("logged += flush_attempts()", SRC)
        body = SRC[SRC.index("def flush() -> int:"):SRC.index("    written = 0")]
        self.assertNotIn("flush_attempts(", body)

    def test_it_is_flushed_after_the_loop_too(self) -> None:
        """打ち切られた回のぶんを落とさない。"""
        tail = SRC[SRC.index("    written += flush()\n    logged += flush_attempts()"):]
        self.assertTrue(tail.startswith("    written += flush()"))

    def test_a_dry_run_writes_nothing(self) -> None:
        body = SRC[SRC.index("def flush_attempts("):SRC.index("def flush() -> int:")]
        self.assertIn("args.dry_run", body)


class ExclusionIsTheDefaultOnceMeasured(unittest.TestCase):
    """2026-10-01 に «2 度目で取れる率» を実測し（2.82% 対 初回 54.35%）既定を «除く» へ変えた。

    ⚠️ この class は 2026-10-01 までは `ExclusionIsOptInUntilMeasured` という名前で
    «既定では除かない» を固定していた。**実測が済んだので逆向きに固定し直す。**
    `_select_sql` 自身は引数で両方できるままにしてある（捨てていないことを下で固定する）。
    """

    def test_the_default_excludes(self) -> None:
        self.assertIn("skip_known_empty = not args.include_known_empty", SRC)

    def test_bringing_them_back_is_still_possible(self) -> None:
        # 2.82% は 0 ではない（70,164 件 × 2.82% ≒ 1,978 件）。新規在庫が無い日に崩しに行ける。
        self.assertIn("--include-known-empty", SRC)
        self.assertNotIn("sns_caption_attempt", _sql(skip_known_empty=False))

    def test_the_numbers_behind_the_default_are_written_down(self) -> None:
        for n in ("54.35", "2.82", "154,107"):
            self.assertIn(n, SRC, f"{n} が消えると、次に誰かが理由なく既定を戻す")

    def test_the_flag_excludes(self) -> None:
        self.assertIn("sns_caption_attempt", _sql(skip_known_empty=True))
        self.assertIn("post_id NOT IN (", _sql(skip_known_empty=True))

    def test_a_post_that_ever_yielded_a_body_is_not_excluded(self) -> None:
        """一度でも取れた投稿は «空しか返らない» ではない。"""
        self.assertIn("COUNTIF(outcome = 'ok') = 0", m.known_empty_sql("t"))

    def test_only_posts_with_an_actual_empty_are_excluded(self) -> None:
        """error しか無い投稿（相手の一時障害）を終端にしない。"""
        self.assertIn("COUNTIF(outcome = 'empty') > 0", m.known_empty_sql("t"))

    def test_which_side_it_ran_on_is_in_the_log(self) -> None:
        head = SRC[SRC.index("skip_known_empty = not args.include_known_empty"):]
        self.assertIn("LOGGER.info", head[:400])


class TheDryRunAnswersThePoolQuestion(unittest.TestCase):
    """2026-09-27、«プールは何件か» を dry run で聞いたら «20000 件»（--limit）が返った。"""

    def test_the_count_before_the_limit_is_logged(self) -> None:
        self.assertIn("対象プール %d 件（--limit 適用後 %d 件）", SRC)

    def test_the_pool_is_measured_before_slicing(self) -> None:
        i_pool = SRC.index("pool = len(targets)")
        i_cut = SRC.index("targets = targets[:args.limit]")
        self.assertLess(i_pool, i_cut, "--limit で切った後に数えている")


class TheAttemptTableIsCreated(unittest.TestCase):
    def test_it_is_created_next_to_the_backfilled_one(self) -> None:
        self.assertIn("CREATE_ATTEMPT_SQL.replace(", SRC)

    def test_it_is_clustered_for_the_lookup(self) -> None:
        self.assertIn("CLUSTER BY post_id, outcome", m.CREATE_ATTEMPT_SQL)

    def test_it_is_append_only(self) -> None:
        self.assertIn("append-only", m.CREATE_ATTEMPT_SQL)
        self.assertNotIn("delete_run_rows", SRC)


if __name__ == "__main__":
    unittest.main()
