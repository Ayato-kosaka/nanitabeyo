#!/usr/bin/env python3
"""9_1 の «値 UPDATE» を、**ソースから**抜き出して psql へ渡せる形で出す。

## なぜ要るか

`test_9_1_overwrite_guard.sh` は値 UPDATE を **簡略化して写経していた**
（`UPDATE restaurants r SET name = s.name FROM ... WHERE ...`）。そのため
2026-09-23 に本番側へ «中身が同じ行は書き直さない» 条件を足しても、
**テストはその条件を 1 度も通らないまま緑**だった。

CLAUDE.md「本番のロジックをテストへ写経しない。ソースから抜き出すか、
共通化して両方から呼ぶ」のとおり、抜き出す側へ寄せる。
`extract_links_sql.py` と同じ作法である。

## 何をしているか

値 UPDATE は f-string で、`{_set_clause()}` と `{_changed_predicate()}` を
本体モジュールの関数から組み立てている。ここでも **同じ関数を呼んで**埋める
（文字列を書き写さない）。本体は BigQuery / psycopg2 を import するので、
AST から必要な定義だけを取り出して実行する。
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"

# 値 UPDATE の SQL テンプレート（f-string の中身）
TEMPLATE = re.compile(r'"値 UPDATE",\s*f"""\s*(UPDATE restaurants r.*?)"""', re.S)

# 本体から借りる定義。依存を引き込まないため AST で切り出す
BORROWED = {"SYNCED_COLUMNS", "_set_clause", "_changed_predicate"}


def borrow_helpers(src: str) -> dict:
    tree = ast.parse(src)
    keep = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in BORROWED:
            keep.append(node)
        elif isinstance(node, ast.AnnAssign) and getattr(node.target, "id", None) in BORROWED:
            keep.append(node)
    if len(keep) != len(BORROWED):
        sys.exit(f"本体から {BORROWED} を取り出せませんでした（見つかったのは {len(keep)} 個）")
    module = ast.fix_missing_locations(ast.Module(body=keep, type_ignores=[]))
    namespace: dict = {}
    exec(compile(module, "<borrowed>", "exec"), namespace)
    return namespace


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--keep-range",
        action="store_true",
        help="バッチの範囲条件（%%(lo)s / %%(hi)s）を残す。既定は落とす（psql が解釈できないため）",
    )
    args = parser.parse_args()

    src = SOURCE.read_text(encoding="utf-8")
    found = TEMPLATE.findall(src)
    if len(found) != 1:
        sys.exit(f"値 UPDATE の SQL を一意に取れませんでした（{len(found)}件）")

    helpers = borrow_helpers(src)
    sql = found[0].replace("{_set_clause()}", helpers["_set_clause"]())
    sql = sql.replace("{_changed_predicate()}", helpers["_changed_predicate"]())

    if not args.keep_range:
        # #1881 psql は psycopg2 の名前付きプレースホルダを解釈できない。
        # ⚠️ «範囲条件が付いていること» は test_9_1_batched_statements.py が縛る。
        sql = re.sub(r"\n\s*AND s\.google_place_id (>|<=) %\(\w+\)s", "", sql)

    sys.stdout.write(sql.replace("%%", "%"))


if __name__ == "__main__":
    main()
