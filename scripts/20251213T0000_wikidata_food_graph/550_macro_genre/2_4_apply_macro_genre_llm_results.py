#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_4_apply_macro_genre_llm_results.py

【目的】
wikidata_food_llm_labels から dish_blacklist と macro_genre を更新する

【処理内容】
1. wikidata_food_llm_labels から統計情報を取得（確認用）
2. decision='A' かつ confidence='high' を dish_blacklist に反映
3. decision='B'/'C' の集計を表示（将来の macro_genre 反映用）

【使用方法】
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251217T0000_v1

# dry-run モード（実際には反映しない）
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251217T0000_v1 --dry-run

【注意】
- decision='A' の高信頼度のみを dish_blacklist に自動反映
- decision='B'/'C' の処理は将来の拡張で実装
"""

import sys
import logging
import argparse

# #550 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
from pathlib import Path
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
TASK_NAME = "#550_macro_genre_abc_classification"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Apply macro_genre LLM results")
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID to apply (e.g., 20251217T0000_v1)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be applied without actually applying"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 2-4: Applying macro_genre LLM results")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Task: {TASK_NAME}")
    logger.info(f"Run ID: {args.run_id}")
    if args.dry_run:
        logger.info("DRY-RUN MODE: Changes will NOT be applied")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 統計情報を取得
    logger.info("Fetching macro_genre LLM label statistics...")
    stats = bq_loader.get_macro_genre_llm_label_stats(task=TASK_NAME, run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("Macro Genre LLM Label Statistics:")
    logger.info("=" * 80)
    
    # #550 【設計】decision は A/B/C
    decision_order = ["A", "B", "C"]
    
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
    
    # #550 【設計】適用対象の件数を計算（decision=A の high のみ）
    blacklist_candidates = stats.get("A_high", 0)
    
    logger.info("")
    logger.info("=" * 80)
    logger.info("Application Summary:")
    logger.info("=" * 80)
    logger.info(f"Decision A (blacklist candidates, confidence='high'): {blacklist_candidates}")
    logger.info(f"Decision B (food-related grouping, self macro): {stats.get('B_high', 0)} high")
    logger.info(f"Decision C (dish/drink/item, macro_genre): {stats.get('C_high', 0)} high")
    logger.info("=" * 80)
    
    if blacklist_candidates == 0:
        logger.warning("No candidates to apply to dish_blacklist (decision=A, confidence='high')")
        if not args.dry_run:
            logger.info("Nothing to apply")
            sys.exit(0)
    
    if args.dry_run:
        logger.info("")
        logger.info("DRY-RUN: Would apply the following:")
        logger.info(f"  - Add {blacklist_candidates} items to dish_blacklist (decision=A, confidence='high')")
        logger.info("")
        logger.info("Decision B and C processing:")
        logger.info("  - Decision B: Items marked as 'food-related grouping term' (to be used as self macro)")
        logger.info("  - Decision C: Items with macro_genre suggestions (to be validated against whitelist)")
        logger.info("")
        logger.info("To actually apply, run without --dry-run flag")
        sys.exit(0)
    
    # #550 【設計】実際に適用（decision=A → dish_blacklist）
    logger.info("")
    logger.info("Applying decision=A labels to dish_blacklist...")
    count = bq_loader.apply_macro_genre_llm_labels_to_blacklist(task=TASK_NAME, run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Applied {count} labels (decision=A) to dish_blacklist")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Verify dish_blacklist in BigQuery")
    logger.info("  2. Re-run dish_macro_genre_analysis to reflect new blacklist:")
    logger.info("     cd .. && python3 550_macro_genre/1_3_build_dish_macro_genre_analysis.py")
    logger.info("  3. Review decision=B and C results for future whitelist expansion")
    logger.info("  4. If needed, adjust prompts and re-run with a new run_id")


if __name__ == "__main__":
    main()
