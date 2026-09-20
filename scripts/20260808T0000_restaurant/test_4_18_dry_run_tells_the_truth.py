#!/usr/bin/env python3
"""#1947 `4_18 --dry-run` が «実際の 1,000 倍» の件数を報告していた。

2026-09-20:

| | 未問い合わせ | 済み |
| --- | ---: | ---: |
| `--dry-run` の報告 | **60,442** | 0 |
| 同じ条件の実行 | **55** | 60,413 |

dry run は «本当に流したら何件 Google へ聞くか» を**課金する前に**知るための道具である。
済みキーを読まなければ答えは常に «全キー» になり、道具として役に立たないどころか、
その数字を根拠に «在庫が 6 万件ある» と報告してしまう（実際にした）。
"""
from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SOURCE = (HERE / "4_18_resolve_place_id_by_name.py").read_text(encoding="utf-8")


class DryRunMustNotSkipTheDoneKeysTest(unittest.TestCase):
    def test_done_keys_are_loaded_unconditionally(self) -> None:
        self.assertIn("done = load_done_keys(pipeline)", SOURCE)
        self.assertNotIn("load_done_keys(pipeline) if not args.dry_run", SOURCE)

    def test_no_branch_on_dry_run_around_done_keys(self) -> None:
        """`args.dry_run` で済みキーの読み込みを分岐し直す退行を止める。"""
        tree = ast.parse(SOURCE)
        for node in ast.walk(tree):
            if isinstance(node, ast.IfExp) and "load_done_keys" in ast.dump(node):
                self.fail("済みキーの読み込みが条件式で分岐している（dry run が嘘をつく）")

    def test_load_done_keys_handles_offline_itself(self) -> None:
        """場合分けが要らない根拠。pipeline が None なら関数側が空集合を返す。"""
        func = next(n for n in ast.walk(ast.parse(SOURCE))
                    if isinstance(n, ast.FunctionDef) and n.name == "load_done_keys")
        guards = [n for n in ast.walk(func) if isinstance(n, ast.If)
                  and "pipeline" in ast.dump(n.test)]
        self.assertTrue(guards, "load_done_keys が pipeline None を自分で扱っていない")


if __name__ == "__main__":
    unittest.main()
