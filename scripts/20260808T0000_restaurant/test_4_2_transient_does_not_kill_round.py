#!/usr/bin/env python3
"""#1947 1 アカウントの一時エラーで収集ラウンド全体が死ぬのを止める。

2026-09-20 20:30、`--max-minutes 330` で投げた収集が **開始 2 分**で落ちた。

    RuntimeError: IG API 500: {"error":{..., "is_transient": true, "code": 2}}

`_get` は一時エラーを 3 回まで再送するが、**使い切ると素の `RuntimeError`** を投げ、
それが `for acc in accounts` を突き抜けてラウンドごと終了させていた。
相手が «一時的» と自己申告している失敗で 5.5 時間の予算を捨てるのは割に合わない。

⚠️ ただし «全部飛ばす» にすると、IG 障害中に全アカウントを «呼んだが 0 件» として
台帳へ焼き付け、次の run が二度と拾わなくなる。連続回数で止める。
"""
from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "collect_account_posts", HERE / "4_2_collect_account_posts.py")
collect = importlib.util.module_from_spec(_spec)
sys.modules["collect_account_posts"] = collect
_spec.loader.exec_module(collect)

SOURCE = (HERE / "4_2_collect_account_posts.py").read_text(encoding="utf-8")


class TransientDoesNotKillTheRoundTest(unittest.TestCase):
    def test_exhausted_retries_raise_a_skippable_type(self) -> None:
        """素の RuntimeError だと呼び出し側で «このアカウントだけ» を切り分けられない。"""
        self.assertTrue(issubclass(collect.TransientExhausted, RuntimeError))
        self.assertIn("raise TransientExhausted(str(last))", SOURCE)
        self.assertNotIn("raise RuntimeError(str(last))", SOURCE)

    def test_the_account_loop_catches_it_and_continues(self) -> None:
        main = next(n for n in ast.walk(ast.parse(SOURCE))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        handlers = [h for h in ast.walk(main) if isinstance(h, ast.ExceptHandler)
                    and h.type is not None and "TransientExhausted" in ast.dump(h.type)]
        self.assertTrue(handlers, "アカウントのループが TransientExhausted を捕まえていない")
        self.assertTrue(
            any(isinstance(node, ast.Continue) for h in handlers for node in ast.walk(h)),
            "捕まえたあと continue しておらず、次のアカウントへ進まない")

    def test_it_stops_when_the_whole_api_is_down(self) -> None:
        """連続で続くなら相手が落ちている。黙ってキューを食い潰さない。"""
        self.assertIsInstance(collect.MAX_CONSECUTIVE_TRANSIENT, int)
        self.assertGreater(collect.MAX_CONSECUTIVE_TRANSIENT, 1)
        main = next(n for n in ast.walk(ast.parse(SOURCE))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        raises = [n for n in ast.walk(main) if isinstance(n, ast.Raise)
                  and "SystemExit" in ast.dump(n)]
        self.assertTrue(raises, "連続一時エラーで止まる分岐が無い")

    def test_the_counter_resets_on_success(self) -> None:
        """成功したら連続カウントを戻す。戻さないと «たまに失敗» で誤って止まる。"""
        self.assertIn("consecutive_transient = 0", SOURCE)

    def test_it_flushes_before_giving_up(self) -> None:
        """止めるときも、それまでに集めた投稿は書き出してから落ちること。"""
        main = next(n for n in ast.walk(ast.parse(SOURCE))
                    if isinstance(n, ast.FunctionDef) and n.name == "main")
        for handler in (h for h in ast.walk(main) if isinstance(h, ast.ExceptHandler)
                        and h.type is not None and "TransientExhausted" in ast.dump(h.type)):
            dumped = ast.dump(handler)
            if "SystemExit" in dumped:
                self.assertIn("_flush", dumped, "諦める前に flush していない")


if __name__ == "__main__":
    unittest.main()
