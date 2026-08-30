#!/usr/bin/env python3
"""9_9_backfill_country_code の «国コードを取り出す式» をソースから抜き出す。

#843 テストで SQL を写経すると本物と静かにずれる。抜き出して使う。
import ではなくテキストで取るのは、psycopg2 が入っていない環境でも
テストを回せるようにするため。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_9_backfill_country_code.py"


def main() -> None:
    src = SOURCE.read_text(encoding="utf-8")
    found = re.findall(r'COUNTRY_FROM_COMPONENTS\s*=\s*"""(.*?)"""', src, re.S)
    if len(found) != 1:
        sys.exit(f"式を一意に取れませんでした（{len(found)}件）")
    sys.stdout.write(" ".join(found[0].split()))


if __name__ == "__main__":
    main()
