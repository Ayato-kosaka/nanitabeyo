"""#1629 dev の実ログから «ユーザーが実際に待った時間» を読む（読み取り専用）。

## なぜ要るか

`EXPLAIN ANALYZE` が測るのは **SQL 単体**である。オーナーが踏んだ
「このエリアで再取得がめっちゃ遅い」は 8〜47 秒だったのに、同じクエリの EXPLAIN は
dev で 46 ms しかかからなかった。**差の大半は SQL の外にある**
（接続待ち / Cloud Run のコールドスタート / 同時実行）。それを見るには実際の
リクエストのログを読むしかない。

BigQuery の MCP ツールが無いセッション（トリガーで起きた夜間の自走など）でも
`db-script-run.yml` 経由で同じ数字を読めるようにするためのもの。

⚠️ **SELECT しか投げない。**

使い方（db-script-run.yml）:
  script_path: scripts/db-checks/measure_api_latency.py
  args: --hours 3
  requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
"""

from __future__ import annotations

import argparse
import logging
import sys

from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

PROJECT = "food-scroll"
DATASET = "nanitabeyo_logs_dev"

# p95 がこれを超えたら ⚠ を付ける。30,000 はフロントのタイムアウト
# （useAPICall の API_CALL_TIMEOUT_MS）。そこへ届く前に気づきたいので 1/10 を目安に置く
SLOW_P95_MS = 3000


def q(client, sql, **params):
    job = client.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter(
                    k, "INT64" if isinstance(v, int) else "STRING", v
                )
                for k, v in params.items()
            ]
        ),
    )
    return list(job.result())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=3, help="何時間ぶんを見るか")
    parser.add_argument("--handler", default=None, help="1 つの handler だけ詳しく見る")
    args = parser.parse_args()

    client = bigquery.Client(project=PROJECT)

    logger.info("=" * 72)
    logger.info("# 1. handler ごとの所要時間（ユーザーが待った時間）直近 %d 時間", args.hours)
    logger.info("=" * 72)
    rows = q(
        client,
        f"""
        SELECT
          JSON_VALUE(payload,'$.handler') AS handler,
          COUNT(*) AS n,
          CAST(APPROX_QUANTILES(CAST(JSON_VALUE(payload,'$.total_ms') AS INT64),100)[OFFSET(50)] AS INT64) AS p50,
          CAST(APPROX_QUANTILES(CAST(JSON_VALUE(payload,'$.total_ms') AS INT64),100)[OFFSET(95)] AS INT64) AS p95,
          MAX(CAST(JSON_VALUE(payload,'$.total_ms') AS INT64)) AS max_ms,
          CAST(APPROX_QUANTILES(CAST(JSON_VALUE(payload,'$.queue_ms') AS INT64),100)[OFFSET(95)] AS INT64) AS queue_p95,
          MAX(created_commit_id) AS commit_id
        FROM `{PROJECT}.{DATASET}.backend_event_logs`
        WHERE event_name='response_success'
          AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
        GROUP BY handler ORDER BY p95 DESC LIMIT 20
        """,
        hours=args.hours,
    )
    if not rows:
        logger.info("（この期間のリクエストが 1 件も無い = オーナーが触っていない。**空振り**）")
    for r in rows:
        mark = " <== 遅い" if (r["p95"] or 0) > SLOW_P95_MS else ""
        logger.info(
            "  %-28s n=%-4d p50=%-7s p95=%-8s max=%-8s queue_p95=%-6s %s%s",
            r["handler"], r["n"], r["p50"], r["p95"], r["max_ms"],
            r["queue_p95"], (r["commit_id"] or "")[:8], mark,
        )

    logger.info("")
    logger.info("=" * 72)
    logger.info("# 2. デプロイされている commit（別セッションが古い API を上書きしていないか）")
    logger.info("=" * 72)
    for r in q(
        client,
        f"""
        SELECT created_commit_id AS commit_id, COUNT(*) AS n, MAX(created_at) AS last_at
        FROM `{PROJECT}.{DATASET}.backend_event_logs`
        WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
        GROUP BY commit_id ORDER BY last_at DESC LIMIT 5
        """,
        hours=args.hours,
    ):
        logger.info("  %s  n=%-5d 最終 %s", (r["commit_id"] or "?")[:12], r["n"], r["last_at"])

    logger.info("")
    logger.info("=" * 72)
    logger.info("# 3. フロントのエラー・警告（ユーザーに見えた失敗）")
    logger.info("=" * 72)
    rows = q(
        client,
        f"""
        SELECT event_name, error_level, COUNT(*) AS n, MAX(created_at) AS last_at,
               ANY_VALUE(SUBSTR(TO_JSON_STRING(payload),1,220)) AS sample
        FROM `{PROJECT}.{DATASET}.frontend_event_logs`
        WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
          AND error_level IN ('error','warn')
        GROUP BY event_name, error_level ORDER BY n DESC LIMIT 15
        """,
        hours=args.hours,
    )
    if not rows:
        logger.info("（エラー・警告なし）")
    for r in rows:
        logger.info("  [%s] %-38s n=%-4d %s", r["error_level"], r["event_name"], r["n"], r["last_at"])
        logger.info("        %s", r["sample"])

    if args.handler:
        logger.info("")
        logger.info("=" * 72)
        logger.info("# 4. %s の 1 本ずつ（total = app + queue。queue が大きいなら SQL の問題ではない）", args.handler)
        logger.info("=" * 72)
        for r in q(
            client,
            f"""
            SELECT created_at,
                   CAST(JSON_VALUE(payload,'$.total_ms') AS INT64) AS total_ms,
                   CAST(JSON_VALUE(payload,'$.app_ms') AS INT64) AS app_ms,
                   CAST(JSON_VALUE(payload,'$.queue_ms') AS INT64) AS queue_ms,
                   JSON_VALUE(payload,'$.url') AS url
            FROM `{PROJECT}.{DATASET}.backend_event_logs`
            WHERE event_name='response_success'
              AND JSON_VALUE(payload,'$.handler') = @handler
              AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
            ORDER BY total_ms DESC LIMIT 15
            """,
            hours=args.hours, handler=args.handler,
        ):
            logger.info("  %s total=%-7s app=%-7s queue=%-6s %s",
                        r["created_at"], r["total_ms"], r["app_ms"], r["queue_ms"], (r["url"] or "")[:110])

    return 0


if __name__ == "__main__":
    sys.exit(main())
