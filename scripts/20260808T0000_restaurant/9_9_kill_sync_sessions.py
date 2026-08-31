#!/usr/bin/env python3
"""同期が残した PostgreSQL のセッションを調べ、必要なら止める。#1706

## なぜ要るか

2026-08-31 に、dev への同期（9_1）が **本番と共有の DB を重くして障害を起こした**。
GitHub Actions の run を cancel してもランナーが消えるだけで、PostgreSQL は
**切断にすぐ気付かない**。走っている 1 文が終わる（最大 30 分）まで、backend は
資源を使い続ける。

そこで «まだ生きているか» を見て、生きていれば止める手段を持つ。

## 安全のための制約

- 既定は **調べるだけ**。止めるのは `--terminate` を付けたときだけ
- 止める対象は **この同期のセッションだけ**に限る（下の SESSION_PREDICATE）。
  アプリの接続・他のバッチは対象にしない
- 自分自身は止めない

    9_9_kill_sync_sessions.py --schema dev                 調べるだけ
    9_9_kill_sync_sessions.py --schema dev --terminate     止める
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# #1706 «この同期のセッション» の定義。**ここを緩めないこと。**
# 9_1 だけが restaurant_sync_staging という TEMP 表を使う。アプリの接続も
# 他のバッチもこの名前に触らないので、これが最も狭い識別子である。
SESSION_PREDICATE = """
  pid <> pg_backend_pid()
  AND state <> 'idle'
  AND query ILIKE '%restaurant_sync_staging%'
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="同期が残した PostgreSQL セッションを調べ、必要なら止めます"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--terminate", action="store_true", help="指定したときだけ止める"
    )
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    connection.rollback()
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            # まず «DB 全体で何が走っているか» を出す。同期以外の重い接続が
            # 原因のこともあるので、犯人を決めつけずに全部見せる。
            cursor.execute(
                """
                SELECT pid, state,
                       date_trunc('second', now() - query_start) AS running_for,
                       date_trunc('second', now() - xact_start)  AS xact_for,
                       wait_event_type, wait_event,
                       left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND state <> 'idle'
                ORDER BY xact_start NULLS LAST
                """
            )
            rows = cursor.fetchall()
            LOGGER.info("動いている接続: %d 本", len(rows))
            for pid, state, running, xact, wtype, wevent, query in rows:
                LOGGER.info(
                    "  pid=%-8s state=%-8s query=%-9s xact=%-9s wait=%s/%s",
                    pid, state, running, xact, wtype, wevent,
                )
                LOGGER.info("      %s", query)

            cursor.execute(f"SELECT pid FROM pg_stat_activity WHERE {SESSION_PREDICATE}")
            targets = [r[0] for r in cursor.fetchall()]
            LOGGER.info("うち同期のセッション: %d 本 %s", len(targets), targets)

            if not targets:
                LOGGER.info("止めるものはありません")
                return
            if not args.terminate:
                LOGGER.info("調べるだけで終了しました（止めるには --terminate）")
                return

            for pid in targets:
                cursor.execute("SELECT pg_terminate_backend(%s)", (pid,))
                LOGGER.warning("pid=%s を止めました: %s", pid, cursor.fetchone()[0])
    finally:
        connection.close()


if __name__ == "__main__":
    main()
