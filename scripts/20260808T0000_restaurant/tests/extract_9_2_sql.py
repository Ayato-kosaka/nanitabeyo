#!/usr/bin/env python3
"""9_2_sync_sns_dish_media.py の SQL 定数をソースから抜き出す。

テストへ SQL を写経すると本物と静かにずれる（#843 で 2026-08-29 に実際に起きた）。
`--name SQL_INSERT_DISH_MEDIA` のように定数名を渡すと、その中身を標準出力へ出す。

ast で読むので psycopg2 / google-cloud-bigquery が入っていなくても動く。
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_2_sync_sns_dish_media.py"


def sql_constants() -> dict[str, str]:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    found: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not isinstance(node.value, ast.Constant) or not isinstance(
            node.value.value, str
        ):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id.startswith("SQL_"):
                found[target.id] = node.value.value
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    constants = sql_constants()
    if args.list:
        print("\n".join(sorted(constants)))
        return
    if args.name is None:
        sys.exit("--name か --list を指定してください")
    if args.name not in constants:
        sys.exit(f"{args.name} が 9_2 に見つかりません: {sorted(constants)}")
    # psycopg2 のリテラル %% は psql では % 一つ
    sys.stdout.write(constants[args.name].replace("%%", "%"))


if __name__ == "__main__":
    main()
