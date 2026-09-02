#!/usr/bin/env python3
"""dev と public の構造差分を 1 接続でまとめて出す読み取り専用スクリプト。

## なぜ要るのか

このリポジトリの dev と public は **同じ DB の別スキーマ**である。にもかかわらず
`scripts/apply-migration.sh` は «どこまで当てたか» を DB に記録せず、実行者が
from_file を手で指定する。指定を誤れば当たらないファイルが無言で生まれ、
**片方のスキーマにだけ在る／無い**という食い違いが誰にも気付かれずに残る。

2026-08-26 に実際に見つかった:
  - `idx_restaurants_location`（GIST）… dev に無い / public に在る
  - `idx_restaurants_name_trgm`（GIN） … dev に在る / public に無い

`audit_schema_indexes.py` は «migration の宣言 vs 1 つのスキーマ» を見る。
こちらは «スキーマ同士» を直接突き合わせる。同じ DB なので 1 接続で両方引ける。

## 何を比べるか

- テーブルの有無
- 列の有無・型・NOT NULL・**生成列かどうか**（`location` のような GENERATED は
  素の列として作られていると値が入らず、機能が静かに壊れる）
- 索引の有無・定義（スキーマ名の違いは正規化して比べる）
- 制約の有無・定義

## 読み取り専用である

SELECT しか実行しない。差分を見つけても直さない。

## 使い方

    python scripts/db-checks/audit_schema_drift.py
    python scripts/db-checks/audit_schema_drift.py --left dev --right public

終了コード: 差分があってもエラーにはしない（0）。«報告» が目的のスクリプトである。
`--fail-on-drift` を付けたときだけ差分ありで 1 を返す。

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import re
import sys

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

TABLES_QUERY = """
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = ANY(%s) AND table_type = 'BASE TABLE'
"""

COLUMNS_QUERY = """
SELECT table_schema, table_name, column_name,
       data_type, is_nullable, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = ANY(%s)
"""

INDEXES_QUERY = """
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = ANY(%s)
"""

CONSTRAINTS_QUERY = """
SELECT n.nspname, t.relname, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = ANY(%s)
"""


def normalize(text: str, left: str, right: str) -> str:
    """スキーマ名だけの違いを消す。`dev.restaurants` と `public.restaurants` を同一視する。"""
    if text is None:
        return ""
    out = re.sub(rf"\b({re.escape(left)}|{re.escape(right)})\.", "", text)
    return re.sub(r"\s+", " ", out).strip()


def report(title: str, only_left: list, only_right: list, differing: list, left: str, right: str) -> bool:
    drift = bool(only_left or only_right or differing)
    logger.info("## %s", title)
    if not drift:
        logger.info("   差分なし")
        logger.info("")
        return False
    if only_left:
        logger.info("   %s にだけ在る（%d 件）:", left, len(only_left))
        for item in sorted(only_left):
            logger.info("     - %s", item)
    if only_right:
        logger.info("   %s にだけ在る（%d 件）:", right, len(only_right))
        for item in sorted(only_right):
            logger.info("     - %s", item)
    if differing:
        logger.info("   定義が違う（%d 件）:", len(differing))
        for key, lv, rv in sorted(differing):
            logger.info("     - %s", key)
            logger.info("         %-7s: %s", left, lv)
            logger.info("         %-7s: %s", right, rv)
    logger.info("")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--left", default="dev")
    parser.add_argument("--right", default="public")
    parser.add_argument("--fail-on-drift", action="store_true")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    left, right = args.left, args.right
    schemas = [left, right]

    with psycopg2.connect(database_url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute("SELECT current_user, current_database()")
            user, database = cur.fetchone()
            logger.info("接続先: user=%s db=%s（%s ⇔ %s）", user, database, left, right)
            logger.info("")

            cur.execute(TABLES_QUERY, (schemas,))
            tables = {s: set() for s in schemas}
            for schema, name in cur.fetchall():
                tables[schema].add(name)

            cur.execute(COLUMNS_QUERY, (schemas,))
            columns = {s: {} for s in schemas}
            for schema, table, col, dtype, nullable, generated, gen_expr in cur.fetchall():
                columns[schema][(table, col)] = (
                    dtype,
                    nullable,
                    generated,
                    normalize(gen_expr, left, right),
                )

            cur.execute(INDEXES_QUERY, (schemas,))
            indexes = {s: {} for s in schemas}
            for schema, table, name, definition in cur.fetchall():
                indexes[schema][name] = (table, normalize(definition, left, right))

            cur.execute(CONSTRAINTS_QUERY, (schemas,))
            constraints = {s: {} for s in schemas}
            for schema, table, name, definition in cur.fetchall():
                constraints[schema][(table, name)] = normalize(definition, left, right)

    drift = False

    drift |= report(
        "テーブル",
        sorted(tables[left] - tables[right]),
        sorted(tables[right] - tables[left]),
        [],
        left,
        right,
    )

    # 列は «両方に在るテーブル» についてだけ比べる。片方にしか無いテーブルの列を
    # 全部並べても、上のテーブル差分の焼き直しにしかならない。
    common_tables = tables[left] & tables[right]
    col_left = {k for k in columns[left] if k[0] in common_tables}
    col_right = {k for k in columns[right] if k[0] in common_tables}
    col_diff = [
        (f"{t}.{c}", columns[left][(t, c)], columns[right][(t, c)])
        for (t, c) in sorted(col_left & col_right)
        if columns[left][(t, c)] != columns[right][(t, c)]
    ]
    drift |= report(
        "列（両方に在るテーブルのみ）",
        [f"{t}.{c}" for t, c in col_left - col_right],
        [f"{t}.{c}" for t, c in col_right - col_left],
        col_diff,
        left,
        right,
    )

    idx_left, idx_right = set(indexes[left]), set(indexes[right])
    idx_diff = [
        (name, indexes[left][name][1], indexes[right][name][1])
        for name in sorted(idx_left & idx_right)
        if indexes[left][name][1] != indexes[right][name][1]
    ]
    drift |= report(
        "索引",
        [f"{n}（table: {indexes[left][n][0]}）" for n in idx_left - idx_right],
        [f"{n}（table: {indexes[right][n][0]}）" for n in idx_right - idx_left],
        idx_diff,
        left,
        right,
    )

    con_left = {k for k in constraints[left] if k[0] in common_tables}
    con_right = {k for k in constraints[right] if k[0] in common_tables}
    con_diff = [
        (f"{t}.{n}", constraints[left][(t, n)], constraints[right][(t, n)])
        for (t, n) in sorted(con_left & con_right)
        if constraints[left][(t, n)] != constraints[right][(t, n)]
    ]
    drift |= report(
        "制約（両方に在るテーブルのみ）",
        [f"{t}.{n}" for t, n in con_left - con_right],
        [f"{t}.{n}" for t, n in con_right - con_left],
        con_diff,
        left,
        right,
    )

    if drift:
        logger.info("⚠️ 差分あり。上の一覧を migration で埋めるかどうかは人が判断する。")
    else:
        logger.info("✅ %s と %s に構造差分はありません。", left, right)

    return 1 if (drift and args.fail_on_drift) else 0


if __name__ == "__main__":
    sys.exit(main())
