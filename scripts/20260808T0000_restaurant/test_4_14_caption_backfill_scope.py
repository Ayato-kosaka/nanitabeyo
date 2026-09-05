"""#1273 4_14 が «caption 列以外を書き換えない» ことをテストで固定する。

`sns_post_raw` は 4_14 だけが触るテーブルではない。別のジョブが
`discovery_seed_place_id` / `seed_source` を UPDATE し、柱1 の収集が INSERT している。
**過去に 2 度、収集経路の情報を上書きする事故が起きている**ので、
「SET 句に caption 以外が出てこないこと」を機械的に固定する。

同時に固定するもの:
- 既に caption がある行を上書きしない（SELECT 側だけでなく **UPDATE 側にも**ガードが要る。
  選んでから書くまでの間に別ジョブが埋めることがある）
- DML は `execute_dml_retrying` を通る（同時更新の 400 に耐える。理由は pipeline_common）
- `--only-unresolved` は «resolved に 1 行も無い投稿» だけへ絞る。既定は off
"""

from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location(
    "fetch_missing_captions", HERE / "4_14_fetch_missing_captions.py")
fetch_captions = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fetch_captions)

SOURCE = (HERE / "4_14_fetch_missing_captions.py").read_text(encoding="utf-8")

# 触ってはいけない列（収集経路の情報。ここを上書きすると «どこで見つけたか» が消える）
PROTECTED_COLUMNS = (
    "discovery_method", "discovery_seed_place_id", "seed_source", "author_name",
    "discovery_route", "discovery_query", "account_id", "canonical_url",
)


class _FakePipeline:
    def table(self, name: str) -> str:
        return f"proj.ds.{name}"


def _select(**kwargs) -> str:
    return " ".join(fetch_captions._select_sql(_FakePipeline(), **kwargs).split())


class UpdateTouchesOnlyCaptionTest(unittest.TestCase):
    def _update_sql(self) -> str:
        # 本体の UPDATE 文をソースから抜く（写経しない。写経すると本体だけ変わったとき緑のまま通る）
        m = re.search(r"sql = f\"\"\"\s*(UPDATE.*?)\"\"\"", SOURCE, re.S)
        self.assertIsNotNone(m, "4_14 の UPDATE 文が見つからない")
        return " ".join(m.group(1).split())

    def test_set_clause_only_assigns_caption(self) -> None:
        sql = self._update_sql()
        m = re.search(r"\bSET\b(.*?)\bFROM\b", sql, re.I)
        self.assertIsNotNone(m, "UPDATE に SET ... FROM が無い")
        set_clause = m.group(1)
        self.assertRegex(set_clause.strip(), r"^caption\s*=\s*s\.caption$",
                         f"caption 以外を書き換えている: {set_clause}")

    def test_protected_columns_never_appear_in_the_update(self) -> None:
        sql = self._update_sql()
        for col in PROTECTED_COLUMNS:
            self.assertNotIn(col, sql, f"UPDATE が {col} に触れている")

    def test_update_refuses_to_overwrite_an_existing_caption(self) -> None:
        # 選んでから書くまでの間に別ジョブが caption を埋めることがある。
        # SELECT 側のガードだけでは «空だったはず» が守られない。
        sql = self._update_sql()
        self.assertIn("t.caption IS NULL OR LENGTH(t.caption) = 0", sql)

    def test_dml_goes_through_execute_dml_retrying(self) -> None:
        self.assertIn("pipeline.execute_dml_retrying(sql", SOURCE)
        self.assertNotIn("pipeline.execute(sql", SOURCE)


class OnlyUnresolvedTest(unittest.TestCase):
    def test_off_by_default(self) -> None:
        sql = _select(only_with_seed=True, max_per_store=25)
        self.assertNotIn("NOT IN (SELECT post_id", sql)

    def test_restricts_to_posts_with_no_resolve_row_at_all(self) -> None:
        sql = _select(only_with_seed=True, max_per_store=25, only_unresolved=True)
        self.assertIn(
            "AND post_id NOT IN (SELECT post_id FROM `proj.ds.sns_post_resolved` "
            "WHERE post_id IS NOT NULL)", sql)

    def test_still_only_targets_empty_captions(self) -> None:
        for kwargs in ({"only_with_seed": True, "max_per_store": 25},
                       {"only_with_seed": True, "max_per_store": 25, "only_unresolved": True}):
            self.assertIn("(caption IS NULL OR LENGTH(caption) = 0)", _select(**kwargs))


if __name__ == "__main__":
    unittest.main()
