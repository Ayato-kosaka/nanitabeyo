#!/usr/bin/env python3
"""#1881 **staging を全件なめる文が、1 文で書かれていないこと**を縛る。

## なぜ要るか

2026-09-23、dev の dry-run が値 UPDATE で `canceling statement due to statement
timeout` に当たって落ちた（同期 session の statement_timeout は既に 30 分ある）。
国コードの是正で catalog の `row_hash` が全行変わり、**621,966 行すべてが 1 文の
UPDATE に当たった**ためである。列の意味を直すたびに «全行更新» は必ず起きるので、
«速くする» ではなく **«1 文あたりの行数を有限にする»** のが正しい直し方だった。

## 何を縛るか

`apply_sync` の中で `restaurant_sync_staging` を読む文は、

1. `execute_in_key_ranges` で流されていること（`cursor.execute` で直に流さない）
2. その SQL に `%(lo)s` / `%(hi)s` の範囲条件があること

⚠️ **`extract_links_sql.py` は psql へ渡すために範囲条件を落としている。**
落とすだけだと «付け忘れても緑» になるので、付いていることはここで確かめる。

DB もネットワークも要らない。ソースを読むだけである。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"

# `apply_sync` の本体だけを見る（ヘルパ定義や staging 作成は対象外）
APPLY_SYNC = re.compile(r"\ndef apply_sync\(.*?\n(?=\ndef |\Z)", re.S)

# 1 つの execute 呼び出し（`cursor.execute(` / `execute_in_key_ranges(`）と、その SQL
CALL = re.compile(r"(cursor\.execute|execute_in_key_ranges)\((.*?)\n        \)", re.S)

failures: list[str] = []


def main() -> int:
    src = SOURCE.read_text(encoding="utf-8")
    body_match = APPLY_SYNC.search(src)
    if not body_match:
        print("❌ apply_sync が見つかりません（このテストの探し方が壊れています）")
        return 1
    body = body_match.group(0)

    calls = CALL.findall(body)
    if not calls:
        print("❌ apply_sync の中に execute 呼び出しが 1 つも見つかりません")
        return 1

    staging_calls = 0
    for kind, payload in calls:
        if "restaurant_sync_staging" not in payload:
            continue
        staging_calls += 1
        head = payload.strip().splitlines()[0][:60]
        if kind != "execute_in_key_ranges":
            failures.append(
                f"{kind} で staging を直に流しています（範囲へ切ること）: {head}"
            )
            continue
        if "%(lo)s" not in payload or "%(hi)s" not in payload:
            failures.append(f"範囲条件（%(lo)s / %(hi)s）がありません: {head}")

    if staging_calls == 0:
        print("❌ staging を読む文が 1 つも見つかりません（探し方が壊れています）")
        return 1

    for message in failures:
        print(f"❌ {message}")
    if failures:
        return 1

    print(f"✅ staging を読む {staging_calls} 文は、すべて範囲へ切って流している")
    return 0


if __name__ == "__main__":
    sys.exit(main())
