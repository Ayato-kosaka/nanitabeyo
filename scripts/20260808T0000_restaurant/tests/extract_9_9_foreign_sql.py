#!/usr/bin/env python3
"""9_9_audit_foreign_rows.py の SQL を **本物のまま** 取り出す。

テストへ SQL を写経すると本物と静かにずれる（#843 で 2026-08-29 に実際に起きた）。
9_9 の SQL は `common_sns.foreign_restaurant_sql()` を呼んで組み立てるので、
9_2 の抽出（ast で文字列定数を読む）と違い **import して実際に組ませる**。

    --name SQL_COUNTS               … 1 文を出す
    --name REPAIR_DELETE_STATEMENTS … 複数文をセミコロン区切りで出す
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "9_9_audit_foreign_rows.py"


def load_module():
    sys.path.insert(0, str(HERE.parent))
    spec = importlib.util.spec_from_file_location("audit_foreign_rows", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    module = load_module()
    value = getattr(module, args.name, None)
    if value is None:
        sys.exit(f"{args.name} が 9_9_audit_foreign_rows.py にありません")
    statements = value if isinstance(value, list) else [value]
    # psycopg2 の %s（LIMIT）は psql では数字に置き換えて使う。テスト側が :limit で渡す。
    sys.stdout.write(";\n".join(s.replace("%s", ":limit") for s in statements) + ";\n")


if __name__ == "__main__":
    main()
