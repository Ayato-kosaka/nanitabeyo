"""#1273 5_1 の «未処理» の定義を固定する。

同じ post_id が複数の収集 run に入る（cc_wat は ccwat2〜5 で重なり、店アカウントは
fsq と catalog で重なる）。5_1 の anti-join は «この run_id × この resolve_version» に
閉じているので、**別 run で既に解けている投稿をもう一度 resolve へ投げる**。
実測 2026-09-05: どこにも結果が無い投稿は 99,937 なのに、run 単位で数えると 118,283
（1.18 倍）で、cc_wat 系は 1 投稿が最大 4 run に重複していた。

`--skip-resolved-anywhere` はその重複を落とすためのもの。ここでは «SQL に
run_id をまたぐ除外が入っているか» を、フラグの有無の両方で固定する。
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("apply_resolve", HERE / "5_1_apply_resolve.py")
apply_resolve = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(apply_resolve)


class _FakePipeline:
    """execute() を «SQL を捕まえるだけ» に差し替えた最小のスタブ。"""

    def __init__(self) -> None:
        self.sql = ""

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql, params=None):
        self.sql = sql
        return []


def _sql(**kwargs) -> str:
    pipeline = _FakePipeline()
    apply_resolve._fetch_unresolved(pipeline, "raw-run", "res-run", "v1", 100, **kwargs)
    return " ".join(pipeline.sql.split())


class UnresolvedScopeTest(unittest.TestCase):
    def test_default_scope_is_run_local(self) -> None:
        sql = _sql()
        self.assertIn("v.post_id IS NULL", sql)
        self.assertNotIn("NOT IN (SELECT post_id", sql)

    def test_skip_resolved_anywhere_excludes_other_runs(self) -> None:
        sql = _sql(skip_resolved_anywhere=True)
        # run_id / resolve_version の条件を持たない «post_id が居るか» だけの除外であること。
        self.assertIn(
            "AND r.post_id NOT IN (SELECT post_id FROM `proj.ds.sns_post_resolved` "
            "WHERE post_id IS NOT NULL)", sql)

    def test_flag_is_off_by_default_so_reresolve_still_works(self) -> None:
        # 解き直し（--resolve-version を上げて回す）は «結果があるもの» を狙う操作なので、
        # 既定で除外が効いてしまうと 1 件も対象にならない。
        import sys
        argv = sys.argv
        sys.argv = ["5_1", "--run-id", "x"]
        try:
            self.assertFalse(apply_resolve.parse_args().skip_resolved_anywhere)
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()


def _sql_for_run(raw_run_id: str) -> str:
    pipeline = _FakePipeline()
    apply_resolve._fetch_unresolved(pipeline, raw_run_id, "res-run", "v1", 100)
    return " ".join(pipeline.sql.split())


class BacklogSpansManyRunsTest(unittest.TestCase):
    """#1947 2026-09-20: 未 resolve の滞留 212,301 件は **複数の収集 run にまたがる**。

    `--raw-run-id` が完全一致しか受け付けないと、run を 1 本ずつ指定しない限り
    掃き切れない。`%` を含むときは LIKE、`ALL` のときは run を限定しない。
    """

    def test_exact_match_is_still_the_default(self) -> None:
        """既存の «1 run だけ解く» 使い方を壊さないこと。"""
        self.assertIn("r.run_id = @raw_rid", _sql_for_run("sns-2026-09-20-targeted22"))

    def test_a_pattern_sweeps_several_runs(self) -> None:
        sql = _sql_for_run("sns-2026-09-%")
        self.assertIn("r.run_id LIKE @raw_rid", sql)
        self.assertNotIn("r.run_id = @raw_rid", sql)

    def test_all_does_not_restrict_the_collection_run(self) -> None:
        sql = _sql_for_run(apply_resolve.RUN_ID_ALL)
        self.assertNotIn("@raw_rid", sql)
        self.assertIn("WHERE TRUE AND v.post_id IS NULL", sql)


class FindingNothingAtAllIsAMistakeNotAPauseTest(unittest.TestCase):
    """2026-09-20: `--raw-run-id` を渡し忘れて «resolve 側の run_id» が入り、
    対象 0 件のまま 2 シャードが 1 時間アイドルした（`--max-minutes 330` なので
    5.5 時間そうなるはずだった）。

    **1 件も処理しないまま «未処理なし» が出るのは «追いついた» ではなく «指定間違い»。**
    `4_22`（全件 unknown）/ `7_4`（全部 0）と同じ «黙って続けない» 規律をここにも置く。
    """

    def test_it_exits_when_the_first_fetch_is_empty(self) -> None:
        import ast
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        main = next(n for n in ast.walk(ast.parse(source))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        guards = [n for n in ast.walk(main)
                  if isinstance(n, ast.If) and "total" in ast.dump(n.test)
                  and "posts" in ast.dump(n.test)
                  and any(isinstance(c, ast.Raise) for c in ast.walk(n))]
        self.assertTrue(
            guards, "main に «1 件も処理せず対象 0 件なら落ちる» 分岐が無い")

    def test_the_idle_wait_still_exists_for_a_genuine_catch_up(self) -> None:
        """本当に追いついたときは待ってよい。落とすのは «最初から 0 件» のときだけ。"""
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        self.assertIn("idle_sleep_s", source)
        self.assertIn("未処理なし", source)


class CaughtUpIsNotAnErrorTest(unittest.TestCase):
    """2026-09-20 20:30: 追いついているだけの resolve が **exit 1 で赤くなった**。

    同日の «対象 0 件で 1 時間アイドル» を直したガードが、«0 件» の意味を 1 つしか
    見ていなかった。赤が常態になると本物の失敗が埋もれるので、2 つを分ける。

    | 収集 run に投稿が | 未 resolve が | 意味 | どうする |
    | --- | --- | --- | --- |
    | 無い | 0 | run_id の指定間違い | 落ちる |
    | ある | 0 | 追いついた | 正常終了 |
    """

    def test_it_asks_whether_the_collection_run_exists_at_all(self) -> None:
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        self.assertIn("def _raw_run_has_any_post(", source)

    def test_the_guard_branches_on_that_answer(self) -> None:
        import ast
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        main = next(n for n in ast.walk(ast.parse(source))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)
                 and getattr(n.func, "id", "") == "_raw_run_has_any_post"]
        self.assertTrue(calls, "main が «収集 run に投稿があるか» を聞いていない")

    def test_catching_up_returns_instead_of_exiting_nonzero(self) -> None:
        """追いついたときに SystemExit を投げないこと（CI が赤くなる）。"""
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        self.assertIn("追いついている", source)
        # 指定間違いのメッセージは «投稿が 1 件も無い» の方を指すこと
        self.assertIn("に投稿が 1 件も無い", source)

    def test_the_misspecified_case_still_exits(self) -> None:
        import ast
        source = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        main = next(n for n in ast.walk(ast.parse(source))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        raises = [n for n in ast.walk(main) if isinstance(n, ast.Raise)
                  and "SystemExit" in ast.dump(n)]
        self.assertTrue(raises, "指定間違いで落ちる分岐まで消してはいけない")
