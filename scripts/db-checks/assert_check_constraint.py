#!/usr/bin/env python3
"""指定した CHECK 制約が **期待した定義になっているか**を確かめる読み取り専用スクリプト。

## なぜ要るのか

migration が «流れた» ことと、制約が «変わった» ことは別である。

- `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` は、名前が違えば**黙って何もしない**。
  その後の `ADD CONSTRAINT` が «同名で既に在る» で落ちれば気付けるが、
  条件だけを書き換えたつもりで名前を打ち間違えると **古い制約が残ったまま**になる
- `apply-migration.sh` は from_file 以降を全部流すので、**どのファイルが効いたのか**は
  ログを読まないと分からない

`assert_index_valid.py`（`CREATE INDEX CONCURRENTLY` が INVALID を残す問題）と
同じ形の «適用後に自分で確かめる» 番人である。

## 読み取り専用である

`pg_constraint` を SELECT するだけ。DDL も DML も行わない。
直す口は**意図的に持たない**（直すのは migration の仕事である）。

## 使い方

    python scripts/db-checks/assert_check_constraint.py \
      --schema dev \
      --constraint restaurants_subterritory_code_check \
      --contains "BETWEEN 3 AND 100"

    # 複数まとめて（--constraint と --contains は同じ数だけ、同じ順で渡す）
    python scripts/db-checks/assert_check_constraint.py --schema dev \
      --constraint a_check --contains "x > 0" \
      --constraint b_check --contains "y IS NOT NULL"

終了コード:
    0 … 指定した制約がすべて存在し、定義に期待文字列を含む
    1 … 1 つでも「存在しない」または「期待文字列を含まない」があった

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import logging
import os
import re

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# pg_get_constraintdef は空白を正規化して返すので、比較側も正規化して当てる。
_WHITESPACE = re.compile(r"\s+")

DEFINITION_SQL = """
  SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = %s
    AND c.contype = 'c'
    AND c.conname = ANY(%s)
"""


def normalize(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--constraint",
        action="append",
        required=True,
        help="CHECK 制約の名前。--contains と同じ数・同じ順で渡す",
    )
    parser.add_argument(
        "--contains",
        action="append",
        required=True,
        help="その制約の定義に含まれていてほしい文字列",
    )
    args = parser.parse_args()

    if len(args.constraint) != len(args.contains):
        logger.error(
            "❌ --constraint と --contains の数が違います（%d 個 / %d 個）",
            len(args.constraint),
            len(args.contains),
        )
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

            cur.execute(DEFINITION_SQL, (args.schema, args.constraint))
            found = {name: definition for name, definition in cur.fetchall()}

    failures: list[str] = []
    logger.info("")
    for name, expected in zip(args.constraint, args.contains):
        definition = found.get(name)
        if definition is None:
            logger.error("❌ %s … 制約が存在しません", name)
            failures.append(name)
            continue
        if normalize(expected) in normalize(definition):
            logger.info("✅ %s", name)
            logger.info("     %s", definition)
        else:
            logger.error("❌ %s … 期待した定義になっていません", name)
            logger.error("     期待に含まれるべき: %s", expected)
            logger.error("     実際             : %s", definition)
            failures.append(name)

    logger.info("")
    if failures:
        logger.error(
            "❌ %d 件が期待どおりではありません: %s",
            len(failures),
            ", ".join(failures),
        )
        return 1

    logger.info("✅ 指定した %d 件はすべて期待どおりです。", len(args.constraint))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
