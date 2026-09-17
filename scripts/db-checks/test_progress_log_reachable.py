#!/usr/bin/env python3
"""#1666 «進捗ログが continue の後ろにあって出ない» 形を復活させない。

## なぜこのテストが要るか

2026-09-06 のクロール（[run 34022514117](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34022514117)）は
3,000 件を 4 時間 45 分かけて回したのに、進捗ログを **6 行しか出さなかった**。
`if i % 25 == 0:` をループ本体の一番下へ置いていたため、`continue` する経路
（robots で弾いた／到達できなかった／読めなかった＝ 95%）では一度も届かず、
**«読めた店» が偶然 25 の倍数に当たったときだけ**出ていた。

そのせいで「前半 1,350 件で parsed が 1 件」という行を «前半だけ異常» と読み違え、
存在しない原因（前の回が前半を刈り取った）を追いかけた。

> **進捗ログが «普通の経路» で出ないなら、それは進捗ログではない。**

欠陥は個別の値ではなく **形**なので、テストも形に対して書く。
リポジトリ中の `for` ループを AST で読み、`i % N == 0` の進捗ログより手前に
`continue` があるものを赤にする。

## 当てはまらないと判定したもの

`ALLOWED` に理由付きで置く。**書かずに外さない**（次の人が同じ調査をやり直す）。

実行:
    python3 -m unittest scripts/db-checks/test_progress_log_reachable.py
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts"

# 当てはまらないと実データで判定したもの。キーはリポジトリ相対パス。
ALLOWED: dict[str, str] = {
    "scripts/20260808T0000_restaurant/3_2_search_google_place_ids.py": (
        "手前の continue は «日次クォータ枯渇» の 1 本だけで、"
        "それは打ち切りの経路（LOGGER.error を 1 回出して残りを捨てる）である。"
        "普通の経路は必ず進捗ログへ届き、`done` も «片付いた件数» を数える意図で"
        "成功時にしか増えない。ログが出ない状態にはならない。"
    ),
}


def _progress_log_index(body: list[ast.stmt]) -> int | None:
    """ループ本体の直下にある `if <何か> % <数> == 0:` の位置を返す。"""
    for index in reversed(range(len(body))):
        statement = body[index]
        if (
            isinstance(statement, ast.If)
            and isinstance(statement.test, ast.Compare)
            and isinstance(statement.test.left, ast.BinOp)
            and isinstance(statement.test.left.op, ast.Mod)
        ):
            return index
    return None


def find_unreachable_progress_logs(path: Path) -> list[int]:
    """進捗ログより手前に continue があるループの «ログの行番号» を返す。"""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return []
    found: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.For):
            continue
        index = _progress_log_index(node.body)
        if index is None:
            continue
        has_continue_before = any(
            any(isinstance(inner, ast.Continue) for inner in ast.walk(statement))
            for statement in node.body[:index]
        )
        if has_continue_before:
            found.append(node.body[index].lineno)
    return found


class ProgressLogReachableTest(unittest.TestCase):
    def test_no_progress_log_sits_behind_a_continue(self) -> None:
        offenders: list[str] = []
        for path in sorted(SCRIPTS.rglob("*.py")):
            relative = path.relative_to(REPO).as_posix()
            if relative in ALLOWED:
                continue
            for lineno in find_unreachable_progress_logs(path):
                offenders.append(f"{relative}:{lineno}")
        self.assertEqual(
            [],
            offenders,
            "進捗ログが continue の後ろにある。ループの先頭へ移すこと（出ないログは"
            f"進捗ログではない）。当てはまらないなら理由を ALLOWED へ書く: {offenders}",
        )

    def test_allowed_entries_still_exist(self) -> None:
        """除外したファイルが消えた／直ったら、除外も外す。"""
        for relative in ALLOWED:
            path = REPO / relative
            self.assertTrue(path.exists(), f"ALLOWED に無いファイルが残っている: {relative}")
            self.assertNotEqual(
                [],
                find_unreachable_progress_logs(path),
                f"{relative} はもう当てはまらない。ALLOWED から外すこと",
            )


if __name__ == "__main__":
    unittest.main()
