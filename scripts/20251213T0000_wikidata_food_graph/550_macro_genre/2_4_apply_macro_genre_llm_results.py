#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_4_apply_macro_genre_llm_results.py

【目的】
wikidata_food_llm_labels から dish_blacklist を更新し、macro_genre を決定する

【処理内容】
1. wikidata_food_llm_labels から統計情報を取得（確認用）
2. decision='A' かつ confidence='high' を dish_blacklist に反映
3. decision='B'/'C' の処理方針を表示（将来の拡張ポイント）

【使用方法】
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251216T0000_v1

# dry-run モード（実際には反映しない）
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251216T0000_v1 --dry-run
"""

import sys
import logging
import argparse
from pathlib import Path

# #548/#550 【設計】共通モジュールを親ディレクトリから import
sys.path.insert(0, str(Path(__file__).parent.parent))
from loader_bigquery_llm import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
TASK_ID = "#550_macro_genre_abc_classification"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Apply macro_genre LLM results")
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID to apply (e.g., 20251216T0000_v1)"
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
    logger.info(f"Task: {TASK_ID}")
    logger.info(f"Run ID: {args.run_id}")
    if args.dry_run:
        logger.info("DRY-RUN MODE: Changes will NOT be applied")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 統計情報を取得
    logger.info("Fetching LLM label statistics...")
    stats = bq_loader.get_llm_label_stats(run_id=args.run_id)
    
    logger.info("=" * 80)
    logger.info("Macro Genre LLM Decision Statistics:")
    logger.info("=" * 80)
    
    # ヘッダー
    logger.info(f"{'Decision':<20} {'High':<10} {'Medium':<10} {'Low':<10} {'Total':<10}")
    logger.info("-" * 60)
    
    # 各決定ごとに集計
    decision_order = ["A", "B", "C"]
    
    for decision in decision_order:
        high = stats.get(f"{decision}_high", 0)
        medium = stats.get(f"{decision}_medium", 0)
        low = stats.get(f"{decision}_low", 0)
        total = high + medium + low
        
        logger.info(f"{decision:<20} {high:<10} {medium:<10} {low:<10} {total:<10}")
    
    logger.info("=" * 80)
    
    # 適用対象の件数を計算
    blacklist_candidates = stats.get("A_high", 0)
    self_macro_candidates = stats.get("B_high", 0)
    map_to_macro_candidates = stats.get("C_high", 0)
    
    logger.info(f"Decision A (blacklist) with high confidence: {blacklist_candidates}")
    logger.info(f"Decision B (self macro) with high confidence: {self_macro_candidates}")
    logger.info(f"Decision C (map_to_macro) with high confidence: {map_to_macro_candidates}")
    logger.info("")
    
    if blacklist_candidates == 0 and self_macro_candidates == 0 and map_to_macro_candidates == 0:
        logger.warning("No high-confidence decisions to apply")
        sys.exit(0)
    
    if args.dry_run:
        logger.info("DRY-RUN: Would apply the following:")
        logger.info(f"  - Add {blacklist_candidates} items to dish_blacklist (decision=A)")
        logger.info(f"  - Assign self macro to {self_macro_candidates} items (decision=B)")
        logger.info(f"  - Map {map_to_macro_candidates} items to existing macros (decision=C)")
        logger.info("")
        logger.info("To actually apply, run without --dry-run flag")
        sys.exit(0)
    
    # 実際に適用
    # #550 【設計】A: dish_blacklist に追加
    if blacklist_candidates > 0:
        logger.info("Applying decision=A (blacklist) to dish_blacklist...")
        count_a = bq_loader.apply_macro_genre_llm_results_to_blacklist(
            task=TASK_ID,
            run_id=args.run_id
        )
        logger.info(f"Applied {count_a} decision=A items to dish_blacklist")
    
    # #550 【設計】B/C: 今回は統計表示のみ（将来的に macro_genre 反映ロジック追加）
    if self_macro_candidates > 0 or map_to_macro_candidates > 0:
        logger.info("")
        logger.info("=" * 80)
        logger.info("Note: Decision B/C processing")
        logger.info("=" * 80)
        logger.info(f"Decision B (self macro): {self_macro_candidates} items")
        logger.info("  These items will use their own QID as macro_genre (self macro)")
        logger.info("")
        logger.info(f"Decision C (map_to_macro): {map_to_macro_candidates} items")
        logger.info("  These items can be mapped to generic macro categories")
        logger.info("  Review the 'note' field in wikidata_food_llm_labels for macro_genre suggestions")
        logger.info("")
        logger.info("To incorporate B/C into dish_macro_genre_analysis:")
        logger.info("  1. Review decision=C macro_genre suggestions in BigQuery")
        logger.info("  2. Update macro_genre_whitelist as needed")
        logger.info("  3. Run: python3 1_3_build_dish_macro_genre_analysis.py")
        logger.info("")
        logger.info("For decision=B (self macro), items can be handled by:")
        logger.info("  - Setting macro_genre_qid = item_qid in dish_macro_genre_analysis")
        logger.info("  - Or leaving as NULL if preferred (to be addressed in future work)")
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-4 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Verify dish_blacklist in BigQuery")
    logger.info("  2. Review decision=B/C items for macro_genre assignment")
    logger.info("  3. Update macro_genre_whitelist based on decision=C suggestions")
    logger.info("  4. Re-run: python3 1_3_build_dish_macro_genre_analysis.py")
    logger.info("  5. Review: python3 1_5_export_macro_genre_review.py --null-only")


if __name__ == "__main__":
    main()
