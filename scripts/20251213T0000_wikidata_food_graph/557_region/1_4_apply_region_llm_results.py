#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_apply_region_llm_results.py

【目的】
wikidata_food_llm_labels から dish_category_features_catalog に region を反映する

【処理内容】
1. wikidata_food_llm_labels から統計情報を取得（確認用）
2. decision='allow' かつ confidence='high' を dish_category_features_catalog に MERGE
3. 過分削除：今回の allow/high に含まれない item を削除（同 run_id/market のみ）

【使用方法】
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_4_apply_region_llm_results.py --market country:JP --run-id 20251218T0100_jp_v1

# dry-run モード（実際には反映しない）
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --dry-run
"""

import sys
import logging
import argparse

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(__file__).rsplit('/', 2)[0])

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

# #557 【設計】market 定義
VALID_MARKETS = ["scope:global", "country:JP"]


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Apply region LLM results to dish_category_features_catalog")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market to apply (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID to apply (e.g., 20251218T0000_global_v1)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be applied without actually applying"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1-4: Applying region LLM results to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {args.market}")
    logger.info(f"Run ID: {args.run_id}")
    if args.dry_run:
        logger.info("DRY-RUN MODE: Changes will NOT be applied")
    
    # #557 【設計】task ID を market に応じて決定
    if args.market == "scope:global":
        task_id = "#557_region_scope_global"
    elif args.market == "country:JP":
        task_id = "#557_region_country_JP"
    else:
        logger.error(f"Unknown market: {args.market}")
        sys.exit(1)
    
    logger.info(f"Task ID: {task_id}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 統計情報を取得
    logger.info("Fetching region LLM label statistics...")
    stats = bq_loader.get_region_llm_label_stats(task=task_id, run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("Region LLM Label Statistics:")
    logger.info("=" * 80)
    
    # 整形して表示
    decision_order = ["allow", "deny", "uncertain"]
    
    # ヘッダー
    logger.info(f"{'Decision':<15} {'High':<10} {'Medium':<10} {'Low':<10} {'Total':<10}")
    logger.info("-" * 55)
    
    # 各 decision ごとに集計
    for decision in decision_order:
        high = stats.get(f"{decision}_high", 0)
        medium = stats.get(f"{decision}_medium", 0)
        low = stats.get(f"{decision}_low", 0)
        total = high + medium + low
        
        logger.info(f"{decision:<15} {high:<10} {medium:<10} {low:<10} {total:<10}")
    
    logger.info("=" * 80)
    
    # 適用対象の件数を計算
    allow_high = stats.get("allow_high", 0)
    
    logger.info(f"Candidates for dish_category_features_catalog (decision='allow', confidence='high'): {allow_high}")
    
    if allow_high == 0:
        logger.warning("No candidates to apply to dish_category_features_catalog")
        sys.exit(0)
    
    if args.dry_run:
        logger.info("DRY-RUN: Would apply these labels to dish_category_features_catalog")
        logger.info("To actually apply, run without --dry-run flag")
        sys.exit(0)
    
    # 実際に適用
    logger.info("Applying region features to dish_category_features_catalog...")
    count = bq_loader.apply_region_llm_labels_to_features_catalog(
        task=task_id,
        run_id=args.run_id,
        market_key=args.market
    )
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Applied {count} region features to dish_category_features_catalog")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Verify dish_category_features_catalog in BigQuery")
    logger.info("  2. Sample and review the new region features")
    logger.info("  3. If needed, adjust prompts and re-run with a new run_id")
    logger.info("  4. For the other market, run the same workflow with different --market parameter")


if __name__ == "__main__":
    main()
