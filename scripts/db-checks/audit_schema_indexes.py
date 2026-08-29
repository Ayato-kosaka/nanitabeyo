#!/usr/bin/env python3
"""migration が宣言している索引と、実在する索引を突き合わせる読み取り専用スクリプト。

## なぜ要るのか

2026-08-26 に、`idx_restaurants_location` が dev に無く、`idx_restaurants_name_trgm` が
public に無いという **スキーマ間の食い違い**が実測で見つかった。原因は
`scripts/apply-migration.sh` が「どこまで当てたか」を DB に記録せず、
**実行者が from_file を手で指定する**設計にあり、指定を誤れば当たらないファイルが
無言で生まれることにある（`assert_index_valid.py` のヘッダにある INVALID 索引の罠も同じ根）。

`assert_index_valid.py` は「名前を知っている索引」しか調べられない。
**知らない食い違い**を見つけるには、migration 側の宣言を機械的に集めて全件突き合わせるしかない。
これがそのスクリプトである。

## 読み取り専用である

SELECT しか実行しない。DDL も DML も行わない。差分を見つけても直さない
（直すのは migration を 1 本足して db-migrate.yml から流す仕事である）。

## 使い方

    python scripts/db-checks/audit_schema_indexes.py --schema dev
    python scripts/db-checks/audit_schema_indexes.py --schema public

終了コード:
    0 … 宣言されている索引がすべて存在し、かつ VALID
    1 … 「存在しない」か「INVALID」が 1 件でもある

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import re
import sys
from pathlib import Path

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

MIGRATION_DIR = Path("infra/supabase/migrations")

# `--` 以降を落としてから拾う。migration のヘッダには「ロールバック手順」として
# `-- DROP INDEX ...` がコメントで書いてあるファイルが多く、これを実文と誤認すると
# 「宣言されていない」と嘘の判定になる。
COMMENT_RE = re.compile(r"--[^\n]*")
CREATE_RE = re.compile(
    r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_\"]+)",
    re.IGNORECASE,
)
DROP_RE = re.compile(
    r"\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([A-Za-z0-9_\"]+)",
    re.IGNORECASE,
)

# 制約（PRIMARY KEY / UNIQUE）が裏で作る索引は migration に CREATE INDEX として
# 現れないので、「DB にしか無い」側から除くために使う。
CONSTRAINT_INDEXES_QUERY = """
SELECT i.relname
FROM pg_constraint c
JOIN pg_class i ON i.oid = c.conindid
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = %s AND c.conindid <> 0
"""

INDEXES_QUERY = """
SELECT i.relname, idx.indisvalid, idx.indisready, t.relname AS table_name
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
JOIN pg_namespace n ON n.oid = i.relnamespace
WHERE n.nspname = %s
"""


def declared_indexes() -> dict[str, str]:
    """migration をファイル名順に読み、最終的に «在るべき» 索引名 → 宣言ファイル名 を返す。"""
    declared: dict[str, str] = {}
    for path in sorted(MIGRATION_DIR.glob("*.sql")):
        body = COMMENT_RE.sub("", path.read_text(encoding="utf-8"))
        # 1 ファイル内で「作ってから消す」順序も起こりうるので、出現順に処理する
        for match in re.finditer(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b|\bDROP\s+INDEX\b", body, re.IGNORECASE):
            tail = body[match.start():]
            if match.group(0).upper().startswith("CREATE"):
                name = CREATE_RE.match(tail)
                if name:
                    declared[name.group(1).strip('"')] = path.name
            else:
                name = DROP_RE.match(tail)
                if name:
                    declared.pop(name.group(1).strip('"'), None)
    return declared


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", help="検査するスキーマ（既定: dev）")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    declared = declared_indexes()
    logger.info("migration が宣言している索引: %d 件", len(declared))

    with psycopg2.connect(database_url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute("SELECT current_user, current_database()")
            user, database = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, database, args.schema)
            logger.info("")

            cur.execute(INDEXES_QUERY, (args.schema,))
            actual = {row[0]: (row[1], row[2], row[3]) for row in cur.fetchall()}

            cur.execute(CONSTRAINT_INDEXES_QUERY, (args.schema,))
            constraint_indexes = {row[0] for row in cur.fetchall()}

    missing: list[str] = []
    invalid: list[str] = []

    for name in sorted(declared):
        row = actual.get(name)
        if row is None:
            missing.append(name)
            continue
        is_valid, is_ready, _table = row
        if not (is_valid and is_ready):
            invalid.append(name)

    extra = sorted(set(actual) - set(declared) - constraint_indexes)

    if missing:
        logger.error("❌ 宣言されているのに存在しない索引: %d 件", len(missing))
        for name in missing:
            logger.error("   - %s（宣言元: %s）", name, declared[name])
        logger.info("")

    if invalid:
        logger.error("❌ 存在するが INVALID な索引: %d 件 — 作り直しが必要", len(invalid))
        for name in invalid:
            logger.error("   - %s（宣言元: %s）", name, declared[name])
        logger.info("")

    if extra:
        # 失敗にはしない。手で作った索引や、制約由来でない過去の残骸を «見えるように» するだけ。
        logger.info("ℹ️ migration に宣言が無い索引（制約由来を除く）: %d 件", len(extra))
        for name in extra:
            logger.info("   - %s（table: %s）", name, actual[name][2])
        logger.info("")

    if missing or invalid:
        logger.error("❌ schema=%s: 欠落 %d 件 / INVALID %d 件", args.schema, len(missing), len(invalid))
        return 1

    logger.info("✅ schema=%s: 宣言されている %d 件はすべて存在し VALID です", args.schema, len(declared))
    return 0


if __name__ == "__main__":
    sys.exit(main())
