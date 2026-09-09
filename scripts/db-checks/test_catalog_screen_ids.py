#!/usr/bin/env python3
"""UI カタログの «撮る画面 ID» が `catalog/screens.json` に定義されていることを検査する。

## なぜ要るか（2026-09-09 に見つけた事故）

`e2e-mobile/tests/catalog/confirm-restaurant-1671.test.ts` は #1671 の確認ページの
**ネイティブのスクリーンショット**を撮るために書かれていたが、渡している ID
`my-dishes-confirm-restaurant` が `catalog/screens.json` に **存在しなかった**。

`captureScreenIfReachable` は「撮れなかったらログを残して素通りする」作りだが、
**ID の解決（`getScreen`）は try の外**にある。

    export async function captureScreenIfReachable(id, navigate, options) {
        const screen = getScreen(id);   // ← ここで throw する
        try { ... } catch { ...素通り... }

つまり **ID が無い場合はテストが落ちる**（素通りしない）。しかも catalog スコープは
`test_filter` で絞って回すことが多く、**そのファイルが 1 度も実行されないまま
«ネイティブの絵は撮ってあります» と報告される**状態が 5 日続いた。

欠陥を 1 文で言うと:

    **エビデンスを撮る仕掛けが «壊れていても気づけない» 場所に置かれていた。**

Detox を回さないと分からないものを、Detox を回さずに分かるようにする。
ID は文字列リテラルで書かれているので、ソースを読むだけで検査できる。

## 何を検査するか

`captureScreen("...")` / `captureScreenIfReachable("...", ...)` の **第 1 引数が
文字列リテラルのもの**を集め、`catalog/screens.json` の `screens[].id` に
あることを確かめる。変数を渡している箇所は（静的には決まらないので）検査しない。

実行:
    python3 -m unittest scripts/db-checks/test_catalog_screen_ids.py
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = REPO_ROOT / "catalog" / "screens.json"

# 走査する場所。**ここを増やすときは «撮る側» のディレクトリだけにすること**
# （utils/catalog.ts 自身は定義側なので入れない。関数名の定義に当たってしまう）
SOURCE_DIRS = [
    REPO_ROOT / "e2e-mobile" / "tests",
    REPO_ROOT / "e2e-web" / "tests",
    REPO_ROOT / "e2e-web" / "scripts",
]

# `captureScreen("id"` / `captureScreenIfReachable("id"` の第 1 引数（文字列リテラルのみ）。
#
# ⚠️ **行をまたぐ呼び出しを取りこぼさないこと。** 最初に書いた版は 1 行ずつ見ていたので
#    prettier が折り返した
#
#        await captureScreenIfReachable(
#            "my-dishes-confirm-restaurant",
#
#    を **1 件も拾えなかった**。しかも他の 1 行の呼び出しは拾えるので «何件か見つかった»
#    のは事実で、緑のまま «検査している» と読めてしまった。ファイル全体に対して当てる。
CALL_RE = re.compile(r"""captureScreen(?:IfReachable)?\(\s*["']([^"']+)["']""", re.S)


def known_screen_ids() -> set[str]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {screen["id"] for screen in catalog["screens"]}


def used_screen_ids() -> list[tuple[Path, int, str]]:
    """(ファイル, 行番号, ID) の一覧。node_modules は見ない。"""
    found: list[tuple[Path, int, str]] = []
    for source_dir in SOURCE_DIRS:
        if not source_dir.exists():
            continue
        for path in sorted(source_dir.rglob("*.ts")):
            if "node_modules" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            for match in CALL_RE.finditer(text):
                lineno = text.count("\n", 0, match.start()) + 1
                found.append((path.relative_to(REPO_ROOT), lineno, match.group(1)))
    return found


class CatalogScreenIdsTest(unittest.TestCase):
    def test_every_captured_id_is_defined(self) -> None:
        known = known_screen_ids()
        missing = [
            f"{path}:{lineno} — 未定義の画面 ID: {screen_id!r}"
            for path, lineno, screen_id in used_screen_ids()
            if screen_id not in known
        ]
        self.assertEqual(
            missing,
            [],
            "catalog/screens.json に定義の無い画面 ID を撮ろうとしている。"
            "\n  → getScreen() が throw してテストが落ちるため、その画面のエビデンスは **1 枚も撮れない**。"
            "\n  → 定義を screens.json へ足すこと。\n" + "\n".join(missing),
        )

    def test_the_guard_actually_looks_at_something(self) -> None:
        """⚠️ 検査対象が 0 件だと、この検査は **常に緑**になる（無いのと同じ）。

        ディレクトリの移動や関数名の変更で «何も見ていない» 状態に落ちたことに
        気づけるよう、1 件以上見つかることを固定する。
        """
        self.assertGreater(len(used_screen_ids()), 0, "撮影呼び出しを 1 つも見つけられていない")


if __name__ == "__main__":
    unittest.main()
