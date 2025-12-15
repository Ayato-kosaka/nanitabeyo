#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
0_create_macro_genre_tables.py

【目的】
BigQuery に macro_genre 関連のテーブルを作成する

【処理内容】
- migration SQL を実行してテーブルを作成
  - macro_genre_whitelist
  - food_edges_raw
  - dish_category_catalog
  - dish_macro_genre_analysis

【使用方法】
python3 0_create_macro_genre_tables.py

【注意】
- GCP 認証が必要（gcloud auth application-default login）
- テーブルは IF NOT EXISTS で作成されるため、再実行可能
"""

import sys
import logging
from pathlib import Path

# #550 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
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


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Creating BigQuery tables for macro_genre")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # Migration 実行
    logger.info("Executing migration...")
    migration_file = Path(__file__).parent.parent.parent.parent / "infra" / "big-query" / "migration" / "20251213T0000_create_macro_genre_tables.sql"
    
    if not migration_file.exists():
        logger.error(f"Migration file not found: {migration_file}")
        sys.exit(1)
    
    bq_loader.execute_migration(str(migration_file))
    logger.info("Migration completed successfully")
    
    logger.info("=" * 80)
    logger.info("✅ Migration completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_1_build_food_edges_raw.py")


if __name__ == "__main__":
    main()
