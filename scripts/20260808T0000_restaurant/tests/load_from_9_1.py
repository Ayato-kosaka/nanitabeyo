#!/usr/bin/env python3
"""9_1 の backfill 漏れ検知を **ソースから取り出して** 使うための共通口。

#843 テスト側で判定を写経すると本物と静かにずれる。2026-08-29 に実際に
ずれたまま緑になり、dev 同期が 2,115 件で止まった。ここを唯一の入口にする。

9_1 はモジュールごと import すると BigQuery クライアントまで芋づるで読み込み、
環境によっては落ちる。必要な定義だけを AST で取り出して exec する。

  python3 load_from_9_1.py sql                        判定に使う件数SQLを出力
  python3 load_from_9_1.py detect <pipeline行数> [INSERT数...]   1=漏れ / 0=正常
"""

from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"


@dataclass
class Window:
    inserted_count: int | None


def load_detect():
    """本番の detect_backfill_missing をソースから取り出して返す。"""

    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "detect_backfill_missing":
            namespace: dict = {"Any": object}
            exec(compile(ast.Module([node], []), str(SOURCE), "exec"), namespace)
            return namespace["detect_backfill_missing"]
    raise SystemExit("detect_backfill_missing を 9_1 から取り出せませんでした")


def load_count_sql() -> str:
    """«pipeline 行が何行あるか» を数える SQL を 9_1 から取り出す。"""

    hits = re.findall(
        r'"(SELECT COUNT\(\*\) FROM restaurants WHERE created_by_source[^"]*)"',
        SOURCE.read_text(encoding="utf-8"),
    )
    if len(hits) != 1:
        raise SystemExit(f"件数SQLを一意に取れませんでした（{len(hits)}件）")
    return hits[0]


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "sql":
        sys.stdout.write(load_count_sql())
        return
    if len(sys.argv) >= 3 and sys.argv[1] == "detect":
        pipeline_rows = int(sys.argv[2])
        windows = [Window(int(v)) for v in sys.argv[3:]]
        missing, _ = load_detect()(pipeline_rows, windows)
        sys.stdout.write("1" if missing else "0")
        return
    raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
