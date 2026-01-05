#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_apply_region_llm_results.py

【目的】
region gate LLM ラベリング結果を dish_category_features_catalog に反映する

【処理内容】
1. wikidata_food_llm_labels から allow & confidence=high のみ抽出
2. dish_category_features_catalog に MERGE 反映
3. 過分削除（同一 run_id / market / feature_key で今回 allow/high に含まれない item は削除）

【使用方法】
# dry-run モード（実際には反映しない）
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --dry-run

# 実際に反映
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_4_apply_region_llm_results.py --market country:JP --run-id 20251218T0100_jp_v1
"""

import sys
import logging
import argparse
from pathlib import Path

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

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

# market 定義
VALID_MARKETS = ["scope:global", "country:JP"]


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Apply region LLM results to dish_category_features_catalog")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market for this batch (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Dry-run mode (do not actually apply changes)"
    )
    args = parser.parse_args()
    
    market = args.market
    run_id = args.run_id
    dry_run = args.dry_run
    
    logger.info("=" * 80)
    logger.info("Step 1-4: Applying region LLM results to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Dry-run: {dry_run}")
    
    # task 命名
    if market == "scope:global":
        task_id = "#557_region_scope_global"
    elif market == "country:JP":
        task_id = "#557_region_country_JP"
    else:
        logger.error(f"Unknown market: {market}")
        sys.exit(1)
    
    logger.info(f"Task: {task_id}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # #557 【設計】allow & confidence=high のみ自動反映（Precision 最優先）
    logger.info("Applying region gate features...")
    logger.info("Policy: allow & confidence=high only (Precision-first whitelist)")
    
    affected = bq_loader.apply_region_gate_features(
        task=task_id,
        run_id=run_id,
        market=market,
        dry_run=dry_run
    )
    
    if dry_run:
        logger.info(f"[DRY-RUN] Would apply {affected} region gate features")
    else:
        logger.info(f"Applied {affected} region gate features")
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    
    if dry_run:
        logger.info("This was a DRY-RUN. To actually apply changes, run:")
        logger.info(f"  python3 1_4_apply_region_llm_results.py --market {market} --run-id {run_id}")
    else:
        logger.info("Region gate features have been applied to dish_category_features_catalog")
        logger.info("")
        logger.info("Verification query:")
        logger.info(f"""
  SELECT COUNT(*) as count
  FROM `{GCP_PROJECT}.{BQ_DATASET}.dish_category_features_catalog`
  WHERE feature_type = 'gate'
    AND feature_key = 'region:{market}'
    AND run_id = '{run_id}'
        """)


if __name__ == "__main__":
    main()
