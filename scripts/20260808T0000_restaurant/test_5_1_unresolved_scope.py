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
