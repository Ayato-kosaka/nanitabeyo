#!/usr/bin/env python3
"""#1881 取り込みの探索範囲（矩形）が **1 箇所にしか書かれていない**ことを固定する。

## なぜこのテストが要るか

#1881 の欠陥は «矩形で国を決めたこと» そのものより、**同じ数字が 7 箇所へ写経され、
検証スクリプトまでがその写経を使っていた**ことである。作った規則と同じ規則で
確かめていたので、何を作っても緑になった。

そこでこのテストは **リポジトリのソースを読んで**、矩形の数字が
`search_bounds.py` 以外に書かれていないことを見る。写経が復活したら赤くなる。

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_search_bounds.py
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from search_bounds import (  # noqa: E402
    MAX_LAT,
    MAX_LON,
    MIN_LAT,
    MIN_LON,
    in_search_bounds,
    outside_search_bounds_sql,
    search_bounds_sql,
)

# 矩形の «角» を全部書いてよいのはこのファイルだけ。
_DEFINING_FILE = HERE / "search_bounds.py"

# PoC は本番データに触らないので対象外（#1881 の調査で «当てはまらない» と判定済み）。
_EXEMPT_DIRS = {"1276_place_id_free_poc", "0000_open_data_poc", "1636_post_url_survey"}



def _python_sources() -> list[Path]:
    return [
        path
        for path in HERE.rglob("*.py")
        if not (_EXEMPT_DIRS & set(path.relative_to(HERE).parts))
    ]


class SearchBoundsIsDefinedOnceTest(unittest.TestCase):
    def test_no_file_rebuilds_the_rectangle_in_code(self) -> None:
        """`20.0 AND 46.5` のような «矩形を組み立てるコード» が他所に無い。"""
        # コメント行を落としてから探す（経緯の説明は残してよい）
        rebuilt = re.compile(
            r"(BETWEEN\s*20\.0\s*AND\s*46\.5)"
            r"|(BETWEEN\s*122\.0\s*AND\s*154\.0)"
            r"|(20\.0\s*<=.*<=\s*46\.5)"
            r"|(122\.0\s*<=.*<=\s*154\.0)"
        )
        offenders: list[str] = []
        for path in _python_sources():
            if path == _DEFINING_FILE:
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                stripped = line.strip()
                if stripped.startswith("#") or stripped.startswith("--"):
                    continue
                if rebuilt.search(line):
                    offenders.append(f"{path.name}:{lineno}: {stripped}")
        self.assertEqual(
            offenders,
            [],
            "矩形を組み立てるコードが search_bounds.py の外にある:\n"
            + "\n".join(offenders),
        )

    def test_no_file_redefines_the_corner_numbers_as_code(self) -> None:
        """角の数字 4 つを **コードの定数として**持つファイルが他所に無い。

        ⚠️ 判定は AST で行う。コメントや docstring に «経緯として» 数字を書くのは
           許す（それを禁じると、なぜこの矩形なのかを説明できなくなる）。
           禁じているのは **矩形をもう一度組み立てること**である。
        """
        import ast

        corners = {MIN_LAT, MAX_LAT, MIN_LON, MAX_LON}
        offenders: list[str] = []
        for path in _python_sources():
            if path == _DEFINING_FILE or path == Path(__file__).resolve():
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            literals = {
                node.value
                for node in ast.walk(tree)
                if isinstance(node, ast.Constant) and isinstance(node.value, float)
            }
            if corners <= literals:
                offenders.append(path.name)
        self.assertEqual(
            offenders, [], f"矩形の角をコードの定数として持つファイル: {offenders}"
        )


class SearchBoundsBehaviourTest(unittest.TestCase):
    def test_inside_and_outside(self) -> None:
        self.assertTrue(in_search_bounds(35.68, 139.76), "東京が範囲外になっている")
        # ⚠️ ソウルは «範囲の中» である。これが «日本» を意味しないのが #1881 の要点。
        self.assertTrue(in_search_bounds(37.57, 126.98), "ソウルが範囲外になっている")
        self.assertFalse(in_search_bounds(48.86, 2.35), "パリが範囲内になっている")

    def test_missing_or_broken_coordinates_are_not_inside(self) -> None:
        for latitude, longitude in (
            (None, 139.7),
            (35.6, None),
            ("", ""),
            ("abc", "def"),
        ):
            self.assertFalse(in_search_bounds(latitude, longitude))

    def test_sql_uses_the_given_expressions(self) -> None:
        sql = search_bounds_sql("bbox.ymin", "bbox.xmin")
        self.assertIn("bbox.ymin BETWEEN", sql)
        self.assertIn("bbox.xmin BETWEEN", sql)

    def test_outside_sql_is_the_negation_shape(self) -> None:
        sql = outside_search_bounds_sql("c.latitude", "c.longitude")
        self.assertIn("NOT BETWEEN", sql)
        self.assertIn(" OR ", sql)


if __name__ == "__main__":
    unittest.main()
