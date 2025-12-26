#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_create_tables.py

【目的】
BigQuery に Wikidata 食品グラフ用のテーブルを作成する

【処理内容】
- migration SQL を実行してテーブルを作成
  - food_roots（初期データ投入含む）
  - food_nodes_raw
  - food_paths
  - dish_root_summary
  - dish_ancestor_blacklist
  - dish_blacklist

【使用方法】
python3 1_1_create_tables.py

【注意】
- GCP 認証が必要（gcloud auth application-default login）
- テーブルは IF NOT EXISTS で作成されるため、再実行可能
"""

import sys
import logging
from pathlib import Path

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
    logger.info("=" * 80)
    logger.info("Step 1: Creating BigQuery tables for Wikidata food graph")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # Migration 実行
    logger.info("Executing migration...")
    REPO_ROOT = Path(__file__).resolve().parents[2]
    migration_files = [
        REPO_ROOT / "infra" / "big-query" / "migration" / "20251213T0000_create_wikidata_food_tables.sql",
        REPO_ROOT / "infra" / "big-query" / "migration" / "20251215T0000_create_wikidata_food_llm_labels.sql"
    ]

    for migration_file in migration_files:    
        if not migration_file.exists():
            logger.error(f"Migration file not found: {migration_file}")
            sys.exit(1)
        
        bq_loader.execute_migration(str(migration_file))
        
    logger.info("Migration completed successfully")
    
    logger.info("=" * 80)
    logger.info("✅ Step 1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_2_fetch_and_load_nodes.py")


if __name__ == "__main__":
    main()
