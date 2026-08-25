#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_fetch_pageviews.py

【目的】
#737 Wikimedia Analytics API から月次ページビューを取り、seasonality_raw へロードする

【処理内容】
1. 1_1 の input.jsonl を読む
2. 1 記事ずつ API を叩き、取れたものを逐次ローカルへ書く（**中断しても再開できる**）
3. 全件終わったら BigQuery へ append

【なぜ逐次でローカルへ書くのか】
実測で 122 件に 15 分かかる（レート制限のため 1 件あたり 1.3 秒以上のウェイトが要る）。
途中で落ちたときに最初からやり直すと、その分だけ Wikimedia に余計な負荷をかける。
`--resume` で既に取れている記事を飛ばせるようにしてある。

【使用方法】
python3 1_2_fetch_pageviews.py --run-id 20260825T0000
python3 1_2_fetch_pageviews.py --run-id 20260825T0000 --resume
python3 1_2_fetch_pageviews.py --run-id 20260825T0000 --dry-run   # API は叩くが BQ へは入れない
python3 1_2_fetch_pageviews.py --run-id 20260825T0000 --limit 5   # 動作確認用
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import bigquery

sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import ensure_directory, load_yaml_config, read_jsonl, write_jsonl
from lib.pageviews import PageviewsClient

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def raw_schema():
    """dish_category_seasonality_raw のスキーマ"""
    return [
        bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("wiki", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("article", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("ym", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("views", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("source", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("fetched_at", "TIMESTAMP", mode="REQUIRED"),
    ]


def main():
    parser = argparse.ArgumentParser(description="Fetch monthly pageviews")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--resume", action="store_true", help="取得済みの記事を飛ばす")
    parser.add_argument("--dry-run", action="store_true", help="BigQuery へ入れない")
    parser.add_argument("--limit", type=int, default=None, help="先頭 N 件だけ処理する")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    work_dir = Path(config["work_dir"])
    ensure_directory(work_dir)

    items = read_jsonl(work_dir / "input.jsonl")
    if args.limit:
        items = items[: args.limit]

    raw_path = work_dir / f"raw_{args.run_id}.jsonl"
    fetched = read_jsonl(raw_path) if (args.resume and raw_path.exists()) else []
    done_qids = {r["item_qid"] for r in fetched}

    logger.info("=" * 80)
    logger.info("Step 1-2: Fetch pageviews")
    logger.info("=" * 80)
    logger.info(f"run_id: {args.run_id} / 対象 {len(items)} 件 / 取得済み {len(done_qids)} 件")
    logger.info(f"期間: {config['start_ym']} 〜 {config['end_ym']}")

    client = PageviewsClient(
        user_agent=config["user_agent"],
        sleep_sec=float(config["sleep_sec"]),
        max_retries=int(config["max_retries"]),
    )

    now = datetime.now(timezone.utc).isoformat()
    rows = list(fetched)
    not_found = []

    for i, item in enumerate(items, 1):
        if item["item_qid"] in done_qids:
            continue

        monthly = client.fetch_monthly(
            wiki=item["wiki"],
            article=item["article"],
            start_ym=config["start_ym"],
            end_ym=config["end_ym"],
        )

        if monthly is None:
            # 記事が無い。**黙って飛ばさない**（後で「なぜ season が付かないのか」を追えるように）
            not_found.append(f"{item['item_qid']}({item['label_ja'] or item['label_en']})")
            continue

        for m in monthly:
            rows.append(
                {
                    "item_qid": item["item_qid"],
                    "wiki": item["wiki"],
                    "article": item["article"],
                    "ym": m["ym"],
                    "views": m["views"],
                    "source": "wikimedia_pageviews",
                    "run_id": args.run_id,
                    "fetched_at": now,
                }
            )

        # 1 件ごとに書き出す（中断しても --resume で続きから）
        write_jsonl(rows, raw_path, force=True)

        if i % 20 == 0:
            logger.info(f"  ...{i}/{len(items)} 件（累計 {len(rows)} 行）")

    logger.info(f"取得完了: {len(rows)} 行 / 記事が見つからなかったもの {len(not_found)} 件")
    if not_found:
        logger.warning("記事なし: " + ", ".join(not_found))
        logger.warning(
            "→ これらは season の行が作られない（＝補正係数 1.0 で無影響）。"
            "夏物・冬物が含まれていないか 2_1 の前に確認すること。"
        )

    if args.dry_run:
        logger.info(f"Dry run: BigQuery へは入れない。ローカル出力: {raw_path}")
        logger.info("✅ Step 1-2 (dry-run) completed")
        return

    bq_client = BigQueryClient()
    table_id = f"{config['dataset']}.dish_category_seasonality_raw"
    loaded = bq_client.load_from_jsonl(
        table_id, raw_path, raw_schema(), write_disposition="WRITE_APPEND"
    )
    logger.info(f"BigQuery へ {loaded} 行を append しました: {table_id}")
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed")


if __name__ == "__main__":
    main()
