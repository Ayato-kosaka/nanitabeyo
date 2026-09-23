#!/usr/bin/env python3
"""#1947 外部埋め込みの失敗イベントが «1 日あたり何件出ているか» を数える。読み取りのみ。

## なぜこれが要るか

error-triage は **`error_level = 'error'` しか収集しない**（`.claude/skills/error-triage/FORENSICS.md`）。
`ExternalEmbedPlayer` の失敗イベントは 10 種すべて `warn` で出ているので、
**ユーザーが投稿を再生できなくても Issue は 1 件も立たない**。

ただし «だから全部 error に上げる» のは早い。件数を見ずに上げると Issue が洪水になり、
error-triage そのものが読まれなくなる。**上げる前にここで実数を数える。**

## ⚠️ いまは Actions から実行できない（2026-09-23 実測）

`db-script-run.yml` の WIF サービスアカウントは **ログのデータセットを読めない**:

    403 Access Denied: Table food-scroll:nanitabeyo_logs_prod.run_googleapis_com_stdout:
    User does not have permission to query table

つまり **未解決事項 F（埋め込み失敗が error-triage に乗らない）は、件数を数える段で
止まっている**。動かすには次のどちらかが要る:

1. claude.ai の BigQuery コネクタを再認証する（error-triage が使っている経路）
2. WIF の SA に `nanitabeyo_logs_prod` の読み取りを付ける

**件数を見ずに `error_level` を上げてはいけない。** Issue が洪水になると
error-triage そのものが読まれなくなり、いま見えている障害まで見えなくなる。

## 使い方

    python3 scripts/db-checks/count_embed_event_volume.py --days 7
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "20260808T0000_restaurant"))

LOGGER = logging.getLogger("embed-volume")

LOG_TABLE = "food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout"


def build_sql(days: int) -> str:
    return f"""
    SELECT jsonPayload.event_name AS event_name,
           jsonPayload.error_level AS error_level,
           COUNT(1) AS n,
           COUNT(DISTINCT jsonPayload.user_id) AS users,
           ROUND(COUNT(1) / {int(days)}, 1) AS per_day
    FROM `{LOG_TABLE}`
    WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {int(days)} DAY)
      AND jsonPayload.log_type = 'frontend_event_logs'
      AND jsonPayload.event_name LIKE 'external_embed%'
    GROUP BY event_name, error_level
    ORDER BY n DESC
    """


def main() -> int:
    p = argparse.ArgumentParser(description="外部埋め込みの失敗イベントの件数を数える。読み取りのみ")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--print-sql", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    sql = build_sql(args.days)
    if args.print_sql:
        print(sql)
        return 0

    from pipeline_common import BigQueryPipeline  # noqa: PLC0415
    rows = [dict(r) for r in BigQueryPipeline().execute(sql)]
    if not rows:
        # ⚠️ «0 件» と «そもそも届いていない» を混同しない。
        raise SystemExit(
            f"直近 {args.days} 日に external_embed% の frontend イベントが 1 件も無い。"
            "**«失敗が無い» ではなく «ログが届いていない» 可能性がある。**"
            "log_type / event_name の綴りと、アプリのログ送信そのものを先に確かめること。")

    LOGGER.info("直近 %d 日の external_embed イベント（frontend_event_logs）", args.days)
    LOGGER.info("%-44s %-6s %8s %8s %9s", "event_name", "level", "件数", "ユーザー", "件/日")
    for r in rows:
        LOGGER.info("%-44s %-6s %8d %8d %9.1f", r["event_name"], r["error_level"] or "-",
                    int(r["n"] or 0), int(r["users"] or 0), float(r["per_day"] or 0))
    LOGGER.info("")
    LOGGER.info("⚠️ error-triage は error_level='error' しか収集しない。"
                "上の warn は 1 件も Issue にならない。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
