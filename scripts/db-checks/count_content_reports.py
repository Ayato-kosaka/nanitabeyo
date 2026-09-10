#!/usr/bin/env python3
"""通報（content_reports）の未処理件数を数える（読み取り専用）。

## なぜ要るか

`.claude/skills/content-reports/SKILL.md` は「集計は日次ワークフローが Issue に出す」
「`content-report` ラベルの open Issue が無ければその日は何もしなくてよい」と書いているが、
**その日次ワークフローは存在しない**（`.github/workflows/` に通報を集計するものが無い）。
つまり «Issue が 0 件» は «通報が 0 件» の根拠にならず、通報は**誰にも見えていなかった**。

⚠️ **`reason_text` は絶対に出力しない。** 自由記述で第三者の個人情報を含みうるため、
外部（GitHub Issue / チャット / PR）へ転記してよいのは `reason_code` と件数だけ、
というのが content-reports スキルの絶対条件である。このスクリプトは
**そもそも SELECT しない**ことでその条件を構造的に満たす。

## 使い方

    script_path: scripts/db-checks/count_content_reports.py
    args: --schema public
"""

from __future__ import annotations

import argparse
import logging
import os

LOGGER = logging.getLogger(__name__)

# status 別の件数。未処理（pending）が何件あるかがこのスクリプトの主目的。
SQL_BY_STATUS = """
SELECT status, COUNT(1) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM content_reports
GROUP BY status
ORDER BY n DESC
"""

# 未処理のものだけ、何を理由に通報されたかの内訳。reason_text は読まない。
SQL_PENDING_BREAKDOWN = """
SELECT target_type, reason_code, COUNT(1) AS n
FROM content_reports
WHERE status = 'pending'
GROUP BY target_type, reason_code
ORDER BY n DESC
LIMIT 50
"""


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        LOGGER.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            cur.execute(SQL_BY_STATUS)
            rows = cur.fetchall()
            LOGGER.info("=" * 70)
            LOGGER.info("# 通報の status 別件数（schema=%s）", args.schema)
            LOGGER.info("=" * 70)
            if not rows:
                LOGGER.info("  通報は 1 件もありません")
            for status, n, oldest, newest in rows:
                LOGGER.info(
                    "  %-10s %5d 件  最古 %s / 最新 %s", status, n, oldest, newest
                )

            cur.execute(SQL_PENDING_BREAKDOWN)
            rows = cur.fetchall()
            LOGGER.info("-" * 70)
            LOGGER.info("# 未処理（pending）の内訳 ※reason_text は読まない")
            LOGGER.info("-" * 70)
            if not rows:
                LOGGER.info("  未処理の通報はありません")
            for target_type, reason_code, n in rows:
                LOGGER.info("  %-14s %-24s %5d 件", target_type, reason_code, n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
