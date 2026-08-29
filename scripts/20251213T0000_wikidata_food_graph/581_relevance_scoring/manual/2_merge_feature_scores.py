#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_merge_feature_scores.py

【目的】(#1383)
指定 run_id の wikidata_food_llm_feature_scores を、BigQuery 採用版
dish_category_features_catalog に安全に差分MERGEする。

実行する SQL の本体は ../sql/merge_feature_scores_by_run_id.sql（ASSERT による
precheck + MERGE + postcheck を1本のBigQueryスクリプトとして持つ）。このスクリプトは
- --dry-run: 実MERGEを行わず、precheckと同じ判定＋before/after/diffのプレビューのみ表示する
- --apply:   sql/merge_feature_scores_by_run_id.sql をそのまま実行する（ASSERTが落ちれば
             mutationは実行されない）

【使用方法】
python3 manual/2_merge_feature_scores.py --run-id "20260819_manual_dining_pace" --dry-run
python3 manual/2_merge_feature_scores.py --run-id "20260819_manual_dining_pace" --apply

--expected-row-count / --expected-item-count を渡すと、mutation 前にその値との一致を
追加でチェックする（誤った run_id を指定した際の事故防止。#853 の運用と同様だが、
このスクリプトでは値を SQL にハードコードしない）。
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))
from _common import (  # noqa: E402
    CATALOG_FEATURES_TABLE,
    CATALOG_TABLE,
    SCORES_TABLE,
    get_bq_client,
)
from google.cloud import bigquery  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

SQL_PATH = Path(__file__).parent.parent / "sql" / "merge_feature_scores_by_run_id.sql"


def run_id_param(run_id: str) -> bigquery.QueryJobConfig:
    return bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )


def precheck(client: bigquery.Client, run_id: str):
    """sql/merge_feature_scores_by_run_id.sql の ASSERT と同じ判定をSELECTで再現する。"""
    query = f"""
        WITH src AS (
          SELECT item_qid, feature_type, feature_key, score, task, phase, model
          FROM `{SCORES_TABLE}`
          WHERE run_id = @run_id
        ),
        invalid AS (
          SELECT *
          FROM src
          WHERE item_qid IS NULL OR item_qid = ''
            OR feature_type IS NULL OR feature_type = ''
            OR feature_key IS NULL OR feature_key = ''
            OR score IS NULL OR score < 0 OR score > 1
            OR task IS NULL OR task = ''
            OR phase IS NULL OR phase = ''
            OR model IS NULL OR model = ''
        ),
        dup AS (
          SELECT item_qid, feature_type, feature_key, COUNT(*) AS row_count
          FROM src
          GROUP BY item_qid, feature_type, feature_key
          HAVING COUNT(*) > 1
        ),
        catalog_miss AS (
          SELECT DISTINCT s.item_qid
          FROM src s
          LEFT JOIN `{CATALOG_TABLE}` c ON c.item_qid = s.item_qid
          WHERE c.item_qid IS NULL
        )
        SELECT
          (SELECT COUNT(*) FROM src) AS source_rows,
          (SELECT COUNT(DISTINCT item_qid) FROM src) AS source_items,
          (SELECT COUNT(DISTINCT CONCAT(feature_type, '\\u0001', feature_key)) FROM src) AS source_feature_pairs,
          (SELECT COUNT(*) FROM invalid) AS invalid_rows,
          (SELECT COUNT(*) FROM dup) AS duplicate_keys,
          (SELECT COUNT(*) FROM catalog_miss) AS catalog_missing_items
    """
    row = list(client.query(query, job_config=run_id_param(run_id)).result())[0]
    return dict(row.items())


def preview_changes(client: bigquery.Client, run_id: str):
    query = f"""
        SELECT
          s.item_qid,
          c.label_ja,
          s.feature_type,
          s.feature_key,
          s.score AS new_score,
          t.score AS current_score,
          t.run_id AS current_run_id,
          s.run_id AS source_run_id
        FROM `{SCORES_TABLE}` s
        LEFT JOIN `{CATALOG_FEATURES_TABLE}` t
          ON t.item_qid = s.item_qid
          AND t.feature_type = s.feature_type
          AND t.feature_key = s.feature_key
        LEFT JOIN `{CATALOG_TABLE}` c ON c.item_qid = s.item_qid
        WHERE s.run_id = @run_id
        ORDER BY s.item_qid, s.feature_type, s.feature_key
    """
    rows = list(client.query(query, job_config=run_id_param(run_id)).result())

    print("\n" + "=" * 80)
    print(f"📋 変更対象一覧（run_id={run_id}）")
    print("=" * 80)
    for r in rows:
        label = r.label_ja or r.item_qid
        print(f"\n{r.item_qid} {label}")
        print(f"  {r.feature_type}:{r.feature_key}")
        if r.current_score is None:
            print(f"  current: (未存在 → NOT MATCHED, INSERTされる)")
        else:
            diff = r.new_score - r.current_score
            print(f"  current: {r.current_score} (run_id={r.current_run_id})")
            print(f"  new:     {r.new_score} (source_run_id={r.source_run_id})")
            print(f"  diff:    {diff:+.4f}")
    print("=" * 80 + "\n")
    return rows


def postcheck(client: bigquery.Client, run_id: str):
    query = f"""
        SELECT feature_type, feature_key, COUNT(*) AS row_count, COUNT(DISTINCT item_qid) AS item_count
        FROM `{CATALOG_FEATURES_TABLE}`
        WHERE run_id = @run_id
        GROUP BY feature_type, feature_key
        ORDER BY feature_type, feature_key
    """
    print("\n" + "=" * 80)
    print(f"✅ postcheck（run_id={run_id} が反映された行）")
    print("=" * 80)
    for r in client.query(query, job_config=run_id_param(run_id)).result():
        print(f"  {r.feature_type}:{r.feature_key} = {r.row_count} rows / {r.item_count} items")

    totals_query = f"""
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT item_qid) AS total_items,
          COUNTIF(feature_type = 'gate' AND feature_key = 'region:country:JP' AND score > 0) AS positive_jp_gate_rows
        FROM `{CATALOG_FEATURES_TABLE}`
    """
    totals = list(client.query(totals_query).result())[0]
    print(f"\n  catalog total_rows:          {totals.total_rows}")
    print(f"  catalog total_items:         {totals.total_items}")
    print(f"  positive_jp_gate_rows:       {totals.positive_jp_gate_rows}")
    print("=" * 80 + "\n")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run-id", required=True)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Preview only, no MERGE")
    mode.add_argument("--apply", action="store_true", help="Execute the MERGE")
    p.add_argument("--expected-row-count", type=int, default=None)
    p.add_argument("--expected-item-count", type=int, default=None)
    args = p.parse_args()

    client = get_bq_client()

    logger.info("=" * 80)
    logger.info("Manual feature score merge (run_id=%s → dish_category_features_catalog)", args.run_id)
    logger.info("Mode: %s", "dry-run" if args.dry_run else "APPLY")
    logger.info("=" * 80)

    stats = precheck(client, args.run_id)
    logger.info("source rows=%s items=%s feature_pairs=%s", stats["source_rows"], stats["source_items"], stats["source_feature_pairs"])

    problems = []
    if stats["source_rows"] == 0:
        problems.append(f"source run '{args.run_id}' has 0 rows in {SCORES_TABLE}")
    if stats["invalid_rows"] > 0:
        problems.append(f"{stats['invalid_rows']} rows have null/empty required columns or score out of [0,1]")
    if stats["duplicate_keys"] > 0:
        problems.append(f"{stats['duplicate_keys']} duplicate (item_qid, feature_type, feature_key) keys within this run")
    if stats["catalog_missing_items"] > 0:
        problems.append(f"{stats['catalog_missing_items']} item_qids are not present in {CATALOG_TABLE}")
    if args.expected_row_count is not None and stats["source_rows"] != args.expected_row_count:
        problems.append(f"source_rows={stats['source_rows']} != --expected-row-count={args.expected_row_count}")
    if args.expected_item_count is not None and stats["source_items"] != args.expected_item_count:
        problems.append(f"source_items={stats['source_items']} != --expected-item-count={args.expected_item_count}")

    if problems:
        logger.error("❌ precheck failed:")
        for msg in problems:
            logger.error("  - %s", msg)
        sys.exit(1)

    logger.info("✅ precheck passed")
    preview_changes(client, args.run_id)

    if args.dry_run:
        logger.info("[DRY-RUN] no MERGE was executed. Re-run with --apply to write to %s", CATALOG_FEATURES_TABLE)
        return

    logger.info("Executing %s ...", SQL_PATH)
    script_sql = SQL_PATH.read_text(encoding="utf-8")
    job_config = run_id_param(args.run_id)
    query_job = client.query(script_sql, job_config=job_config)
    query_job.result()  # ASSERT違反はここで例外になる
    logger.info("✅ MERGE completed")

    postcheck(client, args.run_id)
    logger.info(
        "Next step: python3 ../../9_2_sync_dish_category_features.py --schema dev --dry-run "
        "(from scripts/20251213T0000_wikidata_food_graph/)"
    )


if __name__ == "__main__":
    main()
