#!/usr/bin/env python3
"""**migration が既に宣言している索引**のうち、そのスキーマに無いものだけを作り直す。

## なぜ «migration を足す» のではなくこれなのか

2026-08-26、dev に `idx_restaurants_location` が無いことが実測で分かった。この索引は
`infra/supabase/migrations/20250802T0300_create_restaurants.sql:21` が **既に宣言している**。
つまり「新しい変更を入れたい」のではなく、**宣言と実態がずれているのを揃え直したい**だけである。

ここへ新しい migration ファイルを積むと、履歴が «作って → すぐ足す» という嘘の経緯になる
（`infra/supabase/migrations/README.md` が禁じている形）。オーナー判断も
「埋め合わせはコミットしなくてよい。ややこしくなるので補正だけしておいて」だった。

そこでこのスクリプトは、**migration に書かれていないものは一切作れない**ようにしてある。
新しい設計を持ち込む余地が無いので、migration の承認フローを迂回することにならない。

## 安全装置

1. **`public` を拒否する。** 本番への適用はリリース手順の一部であり、この道具の責務外
2. **migration が宣言していない索引名を拒否する。** 宣言は
   `scripts/db-checks/audit_schema_indexes.py` と同じ方法で機械的に集める
3. **既に在る索引には触れない。** `IF NOT EXISTS` に加えて事前に実在を確認する
4. **INVALID な索引が残っていたら、作らずに落ちる。** `IF NOT EXISTS` が
   「もう在る」と誤判定して永久にスキップされる罠（assert_index_valid.py のヘッダ参照）へ
   自分から踏み込まないため。作り直しは人が DROP INDEX CONCURRENTLY してから
5. **既定は dry run。** 実際に作るには `--apply` が要る

## 使い方

    python scripts/db-repair/restore_declared_index.py --schema dev --index idx_restaurants_location
    python scripts/db-repair/restore_declared_index.py --schema dev --index idx_restaurants_location --apply

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
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

MIGRATION_DIR = Path("infra/supabase/migrations")
COMMENT_RE = re.compile(r"--[^\n]*")

# 宣言文をまるごと取り出す。索引名だけでなく **CREATE 文そのもの** を migration から
# 持ってくるので、定義を人が書き写して間違える余地が無い。
CREATE_STMT_RE = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?P<name>[A-Za-z0-9_\"]+)\s+ON\s+(?P<rest>[^;]+);",
    re.IGNORECASE,
)


def declared_statements() -> dict[str, tuple[str, str]]:
    """索引名 → (宣言元ファイル名, CREATE 文) を、ファイル名順に畳んで返す。"""
    found: dict[str, tuple[str, str]] = {}
    for path in sorted(MIGRATION_DIR.glob("*.sql")):
        body = COMMENT_RE.sub("", path.read_text(encoding="utf-8"))
        for m in CREATE_STMT_RE.finditer(body):
            name = m.group("name").strip('"')
            found[name] = (path.name, " ".join(m.group(0).split()))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True, help="対象スキーマ。public は拒否する")
    parser.add_argument("--index", action="append", required=True, dest="indexes")
    parser.add_argument("--apply", action="store_true", help="実際に作る（既定は dry run）")
    args = parser.parse_args()

    if args.schema == "public":
        logger.error("❌ public は対象外です。本番への適用はリリース手順の一部であり、この道具では行いません")
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    declared = declared_statements()

    unknown = [i for i in args.indexes if i not in declared]
    if unknown:
        logger.error("❌ migration が宣言していない索引は作れません: %s", ", ".join(unknown))
        return 1

    conn = psycopg2.connect(database_url)
    # CREATE INDEX CONCURRENTLY はトランザクション内で実行できない
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

    with conn.cursor() as cur:
        cur.execute(f'SET search_path TO "{args.schema}", extensions')
        cur.execute("SELECT current_user, current_database()")
        user, database = cur.fetchone()
        logger.info("接続先: user=%s db=%s schema=%s apply=%s", user, database, args.schema, args.apply)
        logger.info("")

        for name in args.indexes:
            source, statement = declared[name]
            cur.execute(
                "SELECT idx.indisvalid, idx.indisready FROM pg_index idx "
                "WHERE idx.indexrelid = to_regclass(%s)",
                (name,),
            )
            row = cur.fetchone()

            if row is not None:
                is_valid, is_ready = row
                if is_valid and is_ready:
                    logger.info("⏭️ %s: 既に在り VALID。何もしません", name)
                    continue
                logger.error(
                    "❌ %s: INVALID な索引が残っています（indisvalid=%s indisready=%s）。"
                    "先に DROP INDEX CONCURRENTLY IF EXISTS %s; を人が実行してください",
                    name, is_valid, is_ready, name,
                )
                return 1

            logger.info("▶ %s（宣言元: %s）", name, source)
            logger.info("   %s", statement)
            if not args.apply:
                logger.info("   （dry run。--apply を付けると実行します）")
                continue

            # CONCURRENTLY を強制する。migration 側が付けていなくても、
            # 稼働中のテーブルへの書き込みを止めないため
            concurrent = re.sub(
                r"^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)",
                lambda m: f"CREATE {m.group(1) or ''}INDEX CONCURRENTLY ",
                statement,
                flags=re.IGNORECASE,
            )
            cur.execute(concurrent)
            logger.info("   ✅ 作成しました")

            cur.execute(
                "SELECT idx.indisvalid, idx.indisready FROM pg_index idx "
                "WHERE idx.indexrelid = to_regclass(%s)",
                (name,),
            )
            after = cur.fetchone()
            if after is None or not (after[0] and after[1]):
                logger.error("   ❌ 作成後も VALID になっていません: %s", after)
                return 1
            logger.info("   ✅ VALID を確認しました")

    conn.close()
    logger.info("")
    logger.info("完了。`scripts/db-checks/audit_schema_indexes.py --schema %s` で全件を確認してください", args.schema)
    return 0


if __name__ == "__main__":
    sys.exit(main())
