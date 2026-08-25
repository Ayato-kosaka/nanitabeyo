#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_2_apply_review.py

【目的】
#737 レビュー結果（approve / reject）を seasonality_review へ append する

【append-only】
同じ item_qid に対して何度でも追記してよい。参照側（publish_features.sql）は
created_at の最新 1 件を採用する。判断を上書き消去しないのは、
「なぜこの料理に季節補正が付いて（付かなくて）いるのか」を後から追えるようにするため。

【validation（すべて通らないと 1 行も入れない）】
- decision が 'approve' / 'reject' のいずれか
- reason が空でない（「なぜ」の無い判断を残さない）
- item_qid が対象 run_id の curve に実在する
- reviewer が空でない

【使用方法】
python3 2_2_apply_review.py --run-id 20260825T0000 \
    --input-jsonl /tmp/wikidata_food_seasonality/review_input_20260825T0000.jsonl \
    --reviewer claude-code --dry-run
python3 2_2_apply_review.py --run-id 20260825T0000 --input-jsonl ... --reviewer owner
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import bigquery

sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import load_yaml_config, read_jsonl

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

VALID_DECISIONS = {"approve", "reject"}


def review_schema():
    return [
        bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("decision", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("reason", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("reviewer", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED"),
    ]


def main():
    parser = argparse.ArgumentParser(description="Apply seasonality review decisions")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--input-jsonl", type=str, required=True)
    parser.add_argument("--reviewer", type=str, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)

    if not args.reviewer.strip():
        raise SystemExit("--reviewer は空にできません")

    items = read_jsonl(Path(args.input_jsonl))
    logger.info("=" * 80)
    logger.info("Step 2-2: Apply review decisions")
    logger.info("=" * 80)
    logger.info(f"入力: {len(items)} 件 / reviewer: {args.reviewer}")

    bq_client = BigQueryClient()

    known_query = f"""
    SELECT DISTINCT item_qid
    FROM `{config['dataset']}.dish_category_seasonality_curve`
    WHERE run_id = '{args.run_id}'
    """
    known = {row.get("item_qid") for row in bq_client.execute_query(known_query)}
    if not known:
        raise SystemExit(f"run_id={args.run_id} の curve が空です。1_3 を先に実行してください。")

    # ── validation。1 件でも駄目なら 1 行も入れない ──
    errors = []
    rows = []
    now = datetime.now(timezone.utc).isoformat()

    for i, item in enumerate(items, 1):
        qid = (item.get("item_qid") or "").strip()
        decision = (item.get("decision") or "").strip()
        reason = (item.get("reason") or "").strip()

        if not qid:
            errors.append(f"{i} 行目: item_qid が空")
            continue
        if qid not in known:
            errors.append(f"{i} 行目: {qid} は run_id={args.run_id} の curve に存在しない")
        if decision not in VALID_DECISIONS:
            errors.append(
                f"{i} 行目: {qid} の decision が不正（'{decision}'）。"
                f"{sorted(VALID_DECISIONS)} のいずれかにしてください"
            )
        if not reason:
            errors.append(
                f"{i} 行目: {qid} の reason が空。"
                "「なぜそう判断したか」の無い行は受け付けません"
            )

        if not errors:
            rows.append(
                {
                    "item_qid": qid,
                    "run_id": args.run_id,
                    "decision": decision,
                    "reason": reason,
                    "reviewer": args.reviewer,
                    "created_at": now,
                }
            )

    if errors:
        logger.error(f"validation エラー {len(errors)} 件。1 行も投入しません:")
        for e in errors[:30]:
            logger.error(f"  - {e}")
        if len(errors) > 30:
            logger.error(f"  ... 他 {len(errors) - 30} 件")
        raise SystemExit(1)

    approved = sum(1 for r in rows if r["decision"] == "approve")
    logger.info(f"検証 OK: approve {approved} 件 / reject {len(rows) - approved} 件")

    if args.dry_run:
        logger.info("Dry run: BigQuery へは入れない")
        for r in rows[:10]:
            logger.info(f"  {r['item_qid']}: {r['decision']} — {r['reason'][:60]}")
        logger.info("✅ Step 2-2 (dry-run) completed")
        return

    table_id = f"{config['dataset']}.dish_category_seasonality_review"
    loaded = bq_client.load_from_rows(
        table_id, rows, review_schema(), write_disposition="WRITE_APPEND"
    )
    logger.info(f"BigQuery へ {loaded} 行を append しました: {table_id}")
    logger.info("=" * 80)
    logger.info("✅ Step 2-2 completed")


if __name__ == "__main__":
    main()
