#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_insert_feature_scores.py

【目的】(#1383)
人間がレビュー済みの feature correction を、run_id 単位で
`wikidata_food_llm_feature_scores` に append する。PostgreSQL には直接書き込まない。

【重要】
このスクリプトは wikidata_food_llm_feature_scores に **INSERT のみ** 行う。
BigQuery 採用版 dish_category_features_catalog への反映は
manual/2_merge_feature_scores.py の責務であり、ここでは行わない。

【保存形式】
phase = manual
model = manual
task  = 明示的な固定値（既定 #1383_manual_relevance_scoring、--task で上書き可）
run_id = CLI引数（必須）

LLM Phase2 と人間による変更を監査上区別するため、phase=phase2 や model=<LLMモデル名> のように
偽装しない。

【使用方法】
# 単一行
python3 manual/1_insert_feature_scores.py \\
  --run-id "20260819_manual_dining_pace" \\
  --item-qid Q483163 \\
  --feature-type dining_pace \\
  --feature-key quick \\
  --score 0.5 \\
  --confidence high \\
  --reason "居酒屋利用が代表的で、短時間利用も可能だがサクッと利用が主代表とは言いにくい" \\
  --dry-run

# 複数行（JSONL）。1行1件、_common.Correction と同じキーを持つJSON。
python3 manual/1_insert_feature_scores.py \\
  --run-id "20260819_manual_dining_pace" \\
  --input-jsonl corrections.jsonl \\
  --dry-run

--dry-run を外すと実INSERTを行う。
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).parent))
from _common import (  # noqa: E402
    CATALOG_FEATURES_TABLE,
    DEFAULT_TASK,
    SCORES_TABLE,
    fetch_current_catalog_scores,
    fetch_dish_labels,
    get_bq_client,
    parse_jsonl_corrections,
    parse_single_correction,
    validate_corrections,
)
from google.cloud import bigquery  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def print_preview(corrections, client, labels):
    current = fetch_current_catalog_scores(client, [c.key() for c in corrections])
    print("\n" + "=" * 80)
    print("📋 before / after preview（採用版 dish_category_features_catalog との比較）")
    print("=" * 80)
    for c in corrections:
        cur = current.get(c.key())
        label = labels.get(c.item_qid, c.item_qid)
        print(f"\n{c.item_qid} {label}")
        print(f"  {c.feature_type}:{c.feature_key}")
        if cur is None:
            print(f"  current: (catalogに未存在 = NOT MATCHED として新規INSERTされる想定)")
        else:
            diff = c.score - cur["score"]
            print(f"  current: {cur['score']} (source={cur['source']}, run_id={cur['run_id']})")
            print(f"  new:     {c.score}")
            # 小数第1位で丸めると、連続 feature の 0.63→0.67 が «+0.0» に見えて
            # «変わっていない» と誤読される（#1637）。実際の桁で出す
            print(f"  diff:    {diff:+.4f}")
        print(f"  confidence: {c.confidence}")
        print(f"  reason:     {c.reason}")
    print("\n" + "=" * 80)
    print(f"合計 {len(corrections)} 件（このタイミングでは catalog には未反映。manual/2_merge_feature_scores.py で反映する）")
    print("=" * 80 + "\n")


def insert_rows(client: bigquery.Client, corrections, run_id: str):
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "item_qid": c.item_qid,
            "feature_type": c.feature_type,
            "feature_key": c.feature_key,
            "score": c.score,
            "confidence": c.confidence,
            "reason": c.reason,
            "phase": "manual",
            "task": c.task,
            "model": "manual",
            "run_id": run_id,
            "created_at": now,
        }
        for c in corrections
    ]
    errors = client.insert_rows_json(SCORES_TABLE, rows)
    if errors:
        raise RuntimeError(f"insert_rows_json returned errors: {errors}")
    return len(rows)


def postcheck(client: bigquery.Client, run_id: str):
    query = f"""
        SELECT
          COUNT(*) AS row_count,
          COUNT(DISTINCT item_qid) AS item_count,
          COUNT(DISTINCT CONCAT(feature_type, '\\u0001', feature_key)) AS feature_pair_count,
          COUNT(*) - COUNT(DISTINCT CONCAT(item_qid, '\\u0001', feature_type, '\\u0001', feature_key)) AS duplicate_keys
        FROM `{SCORES_TABLE}`
        WHERE run_id = @run_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )
    row = list(client.query(query, job_config=job_config).result())[0]

    print("\n" + "=" * 80)
    print(f"✅ postcheck（run_id={run_id}）")
    print("=" * 80)
    print(f"  inserted rows (現run_id合計): {row.row_count}")
    print(f"  distinct items:               {row.item_count}")
    print(f"  distinct feature pairs:       {row.feature_pair_count}")
    print(f"  duplicate keys:               {row.duplicate_keys}")
    if row.duplicate_keys:
        logger.error("❌ duplicate keys detected after insert — this should never happen")
        sys.exit(1)

    query_rows = f"""
        SELECT item_qid, feature_type, feature_key, score, confidence, reason, phase, model, task
        FROM `{SCORES_TABLE}`
        WHERE run_id = @run_id
        ORDER BY item_qid, feature_type, feature_key
    """
    print("\n  run_id で再SELECTした内容:")
    for r in client.query(query_rows, job_config=job_config).result():
        print(f"    {r.item_qid} {r.feature_type}:{r.feature_key} = {r.score} "
              f"(confidence={r.confidence}, phase={r.phase}, model={r.model}, task={r.task})")
    print("=" * 80 + "\n")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Insert human-reviewed manual feature corrections into "
        "wikidata_food_llm_feature_scores (does NOT touch dish_category_features_catalog).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--run-id", required=True, help="Run ID grouping this batch of corrections")
    p.add_argument("--dry-run", action="store_true", help="Validate and preview only; no INSERT")
    p.add_argument(
        "--allow-new-feature-key",
        action="store_true",
        help="Allow (feature_type, feature_key) pairs that do not yet exist in "
        "dish_category_features_catalog (skips the existing-pair check)",
    )

    p.add_argument("--input-jsonl", help="Path to a JSONL file with one correction per line")

    single = p.add_argument_group("single-row input (mutually exclusive with --input-jsonl)")
    single.add_argument("--item-qid")
    single.add_argument("--feature-type")
    single.add_argument("--feature-key")
    single.add_argument("--score", type=float)
    single.add_argument("--confidence", choices=["high", "medium", "low"])
    single.add_argument("--reason")
    single.add_argument("--task", default=DEFAULT_TASK)
    return p


def main():
    args = build_arg_parser().parse_args()

    if args.input_jsonl and any(
        [args.item_qid, args.feature_type, args.feature_key, args.score is not None, args.confidence, args.reason]
    ):
        logger.error("❌ --input-jsonl cannot be combined with single-row flags")
        sys.exit(1)

    if not args.input_jsonl and not all(
        [args.item_qid, args.feature_type, args.feature_key, args.score is not None, args.confidence, args.reason]
    ):
        logger.error(
            "❌ either --input-jsonl, or all of "
            "--item-qid/--feature-type/--feature-key/--score/--confidence/--reason, are required"
        )
        sys.exit(1)

    raw_rows = (
        parse_jsonl_corrections(args.input_jsonl) if args.input_jsonl else parse_single_correction(args)
    )

    client = get_bq_client()

    logger.info("=" * 80)
    logger.info("Manual feature score insert (%s → wikidata_food_llm_feature_scores)", args.run_id)
    logger.info("Dry-run: %s", args.dry_run)
    logger.info("=" * 80)

    result = validate_corrections(
        raw_rows, client, args.run_id, skip_catalog_pair_check=args.allow_new_feature_key
    )
    if not result.ok:
        logger.error("❌ validation failed:")
        for e in result.errors:
            logger.error("  - %s", e)
        sys.exit(1)

    labels = fetch_dish_labels(client, [c.item_qid for c in result.corrections])
    print_preview(result.corrections, client, labels)

    if args.dry_run:
        logger.info("[DRY-RUN] no rows were inserted. Re-run without --dry-run to apply.")
        return

    n = insert_rows(client, result.corrections, args.run_id)
    logger.info("✅ Inserted %d rows into %s", n, SCORES_TABLE)
    postcheck(client, args.run_id)
    logger.info(
        "Next step: python3 manual/2_merge_feature_scores.py --run-id %s --dry-run", args.run_id
    )


if __name__ == "__main__":
    main()
