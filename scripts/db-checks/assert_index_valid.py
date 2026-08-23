#!/usr/bin/env python3
"""指定した index が VALID かを確認する読み取り専用スクリプト。

## なぜ要るのか

`CREATE INDEX CONCURRENTLY` は **失敗しても INVALID な index を残す**。そして
`CREATE INDEX IF NOT EXISTS` は「もう在る」と判断して以後**黙ってスキップし続ける**。
結果、エラーは 1 度も出ないまま索引だけが永久に作られず、その列を使う検索だけが
遅いままになる。適用ログを見ても気付けない。

`infra/supabase/migrations/20260819T0300_add_restaurants_name_trgm_index.sql` の
ヘッダが「適用後に必ず確認すること」として次を指定している:

    SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_restaurants_name_trgm'::regclass;

この確認を、資格情報を対話セッションへ置かずに実行するためのスクリプト。
`db-script-run.yml`（`secrets.POSTGRES_DATABASE_URL` を渡す汎用ランナー）から流す。

## 読み取り専用である

SELECT しか実行しない。DDL も DML も行わない。`--fix` のような口も**意図的に持たない**
（INVALID だった場合の作り直しは DROP INDEX CONCURRENTLY を伴うので、
この確認スクリプトの責務から外す。手順は上記 migration のヘッダにある）。

## 使い方

    python scripts/db-checks/assert_index_valid.py \
      --schema dev \
      --index idx_restaurants_name_trgm

    # 複数まとめて
    python scripts/db-checks/assert_index_valid.py \
      --schema dev \
      --index idx_restaurants_name_trgm --index idx_dmee_status_verified

終了コード:
    0 … 指定した index がすべて存在し、かつ VALID
    1 … 1 つでも「存在しない」または「INVALID」があった

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import sys

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


# 索引の実在と妥当性をまとめて引く。
#
# `to_regclass` を使うのは、存在しない索引名を `'...'::regclass` でキャストすると
# 例外になり「存在しない」と「INVALID」を区別できなくなるため。
# to_regclass は存在しなければ NULL を返すので、両者を分けて報告できる。
#
# indisvalid … false なら CONCURRENTLY が失敗して残った INVALID な索引
# indisready … false なら「作成中で、まだ INSERT/UPDATE を拾えていない」状態
QUERY = """
SELECT
  i.relname                AS index_name,
  idx.indisvalid           AS is_valid,
  idx.indisready           AS is_ready,
  pg_get_indexdef(idx.indexrelid) AS definition
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
WHERE idx.indexrelid = to_regclass(%s)
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema",
        default="dev",
        help="検査するスキーマ（既定: dev）。search_path に設定される",
    )
    parser.add_argument(
        "--index",
        action="append",
        required=True,
        dest="indexes",
        help="検査する索引名。複数回指定できる",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    failures: list[str] = []

    with psycopg2.connect(database_url) as conn:
        # 読み取りしか行わないことを接続レベルでも宣言しておく。
        # 事故で書き込みを足してしまったときに、実行時に落ちて気付ける
        conn.set_session(readonly=True)

        with conn.cursor() as cur:
            # 索引名はスキーマ修飾せずに渡すので、search_path で対象を決める
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            cur.execute("SELECT current_user, current_database()")
            user, database = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, database, args.schema)
            logger.info("")

            for index_name in args.indexes:
                cur.execute(QUERY, (index_name,))
                row = cur.fetchone()

                if row is None:
                    logger.error("❌ %s: 存在しません（schema=%s）", index_name, args.schema)
                    failures.append(index_name)
                    continue

                _, is_valid, is_ready, definition = row

                if is_valid and is_ready:
                    logger.info("✅ %s: VALID", index_name)
                    logger.info("   %s", definition)
                else:
                    # ここが本題。CONCURRENTLY が失敗して残った INVALID な索引は、
                    # IF NOT EXISTS に「在る」と判断されるので二度と作り直されない
                    logger.error(
                        "❌ %s: indisvalid=%s indisready=%s — **作り直しが必要**",
                        index_name,
                        is_valid,
                        is_ready,
                    )
                    logger.error("   %s", definition)
                    logger.error(
                        "   手順: DROP INDEX CONCURRENTLY IF EXISTS %s; "
                        "そのうえで該当 migration を流し直す",
                        index_name,
                    )
                    failures.append(index_name)

    logger.info("")
    if failures:
        logger.error("❌ %d 件が不正です: %s", len(failures), ", ".join(failures))
        return 1

    logger.info("✅ 指定した %d 件はすべて VALID です", len(args.indexes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
