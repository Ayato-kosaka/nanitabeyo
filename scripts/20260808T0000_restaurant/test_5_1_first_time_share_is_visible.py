"""#1947 «その run の仕事のうち何割が初めて解いた投稿か» を毎回ログへ出す（5_1）。

2026-09-21 に resolve の run_id を収集と別名にしたとき、`5_1` の «未処理を取り出す»
anti-join（`v.run_id = @resolve_rid AND v.resolve_version = @resolve_version`）も
一緒に洗うべきだったのに見落とした。以後ラウンドごとに新しい run_id を付けるたび、
**毎回ゼロから全投稿を解き直す**状態になった。

09-21〜09-24 の 3.5 日で書いた 4,626,900 行のうち、初めて解いた投稿は 256,078 行（5.5%）。
ログには「N 件を投入しました」としか出ていなかったので **4 日間だれも気づけなかった**。

このテストは値ではなく **パターン**を固定する:
  1. 速度ではなく «仕事になっている割合» を毎回出す
  2. その割合は «どこにも結果が無かった» で数える（この run_id の中だけで数えない）
  3. 割合が低くても **落とさない・赤くしない**。意図した解き直しでは 0% が正しい
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "5_1_apply_resolve.py"


def _load():
    spec = importlib.util.spec_from_file_location("apply_resolve_fts", SOURCE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["apply_resolve_fts"] = mod
    spec.loader.exec_module(mod)
    return mod


M = _load()


class TheShareIsMeasuredAcrossEveryRun(unittest.TestCase):
    TABLE = "food-scroll.restaurant_recommendation.sns_post_resolved"

    def test_counts_posts_that_exist_nowhere_else(self) -> None:
        sql = M.first_time_share_sql(self.TABLE)
        self.assertIn("run_id != @rid OR resolve_version != @ver", sql,
                      "«この run の中だけ» で数えている。それでは解き直しが見えない")
        self.assertIn("first_time", sql)
        self.assertIn("posts", sql)

    def test_every_parameter_is_bound(self) -> None:
        import re
        sql = M.first_time_share_sql(self.TABLE)
        src = SOURCE.read_text(encoding="utf-8")
        for name in sorted(set(re.findall(r"@([A-Za-z_]\w*)", sql))):
            self.assertIn(f'"{name}"', src, f"@{name} を束ねていない")


class ItReportsButNeverFails(unittest.TestCase):
    def _fn(self) -> ast.FunctionDef:
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "_report_first_time_share":
                return node
        self.fail("_report_first_time_share が無い")

    def test_never_raises_or_exits(self) -> None:
        """⚠️ «正常なのに赤くする» ガードにしない。意図した解き直しでは 0% が正しい。"""
        fn = self._fn()
        for node in ast.walk(fn):
            self.assertNotIsInstance(node, ast.Raise, "落としてはいけない（門ではない）")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotIn(node.func.id, ("SystemExit", "exit"),
                                 "落としてはいけない（門ではない）")

    def test_the_collection_failure_does_not_kill_the_run(self) -> None:
        """集計そのものが失敗しても、resolve の結果は捨てない。"""
        self.assertTrue(any(isinstance(n, ast.Try) for n in ast.walk(self._fn())))

    def test_it_is_called_at_the_end_of_the_run(self) -> None:
        src = SOURCE.read_text(encoding="utf-8")
        self.assertIn("_report_first_time_share(pipeline, run_id, args)", src)

    def test_the_hint_only_appears_when_the_flag_is_absent(self) -> None:
        """`--skip-resolved-anywhere` を付けている run に «付けろ» と言わない。"""
        src = ast.get_source_segment(SOURCE.read_text(encoding="utf-8"), self._fn()) or ""
        self.assertIn("not args.skip_resolved_anywhere", src)


if __name__ == "__main__":
    unittest.main()
