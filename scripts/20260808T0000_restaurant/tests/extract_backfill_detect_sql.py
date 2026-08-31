#!/usr/bin/env python3
"""9_1 の「backfill 漏れ検知」SQL をソースから 1 本だけ抜き出して出力する。

#843 テスト側で SQL を写経すると、本物と静かにずれる。2026-08-29 に実際に
ずれたまま緑になり、dev 同期が 2,115 件で止まった。抜き出して使う。

`%s` プレースホルダは呼び出し側が埋める。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"


def main() -> None:
    src = SOURCE.read_text(encoding="utf-8")
    queries = re.findall(r'"""\s*(SELECT COUNT\(\*\).*?)"""', src, re.S)
    hit = [q for q in queries if "created_by_source <> 'pipeline'" in q]
    if len(hit) != 1:
        sys.exit(f"backfill 検知SQLを一意に取れませんでした（{len(hit)}件）")
    sys.stdout.write(" ".join(hit[0].split()))


if __name__ == "__main__":
    main()
