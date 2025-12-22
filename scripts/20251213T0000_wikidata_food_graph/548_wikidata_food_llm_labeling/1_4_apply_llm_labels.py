#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_apply_llm_labels.py

【目的】
wikidata_food_llm_labels から dish_blacklist を更新する

【処理内容】
1. wikidata_food_llm_labels から統計情報を取得（確認用）
2. confidence='high' かつ label IN ('too_generic', 'non_menu_item', 'not_for_menu', 'unclear_food') を
   dish_blacklist に反映

【使用方法】
python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v1

# dry-run モード（実際には反映しない）
python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v1 --dry-run
"""

import sys
import logging
import argparse

from loader_bigquery import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Apply LLM labels to dish_blacklist")
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID to apply (e.g., 20251215T0000_v1)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be applied without actually applying"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1-4: Applying LLM labels to dish_blacklist")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Run ID: {args.run_id}")
    if args.dry_run:
        logger.info("DRY-RUN MODE: Changes will NOT be applied")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 統計情報を取得
    logger.info("Fetching LLM label statistics...")
    stats = bq_loader.get_llm_label_stats(run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("LLM Label Statistics:")
    logger.info("=" * 80)
    
    # 整形して表示
    label_order = ["keep", "too_generic", "non_menu_item", "not_for_menu", "unclear_food", "uncertain"]
    
    # ヘッダー
    logger.info(f"{'Label':<20} {'High':<10} {'Medium':<10} {'Low':<10} {'Total':<10}")
    logger.info("-" * 60)
    
    # 各ラベルごとに集計
    for label in label_order:
        high = stats.get(f"{label}_high", 0)
        medium = stats.get(f"{label}_medium", 0)
        low = stats.get(f"{label}_low", 0)
        total = high + medium + low
        
        logger.info(f"{label:<20} {high:<10} {medium:<10} {low:<10} {total:<10}")
    
    logger.info("=" * 80)
    
    # 適用対象の件数を計算
    blacklist_candidates = (
        stats.get("too_generic_high", 0) +
        stats.get("non_menu_item_high", 0) +
        stats.get("not_for_menu_high", 0) +
        stats.get("unclear_food_high", 0)
    )
    
    logger.info(f"Candidates for dish_blacklist (confidence='high'): {blacklist_candidates}")
    
    if blacklist_candidates == 0:
        logger.warning("No candidates to apply to dish_blacklist")
        sys.exit(0)
    
    if args.dry_run:
        logger.info("DRY-RUN: Would apply these labels to dish_blacklist")
        logger.info("To actually apply, run without --dry-run flag")
        sys.exit(0)
    
    # 実際に適用
    logger.info("Applying labels to dish_blacklist...")
    count = bq_loader.apply_llm_labels_to_blacklist(run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Applied {count} labels to dish_blacklist")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Verify dish_blacklist in BigQuery")
    logger.info("  2. Sample and review the new blacklist entries")
    logger.info("  3. If needed, adjust prompts and re-run with a new run_id")


if __name__ == "__main__":
    main()
