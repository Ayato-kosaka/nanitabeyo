#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_generate_paths_and_summary.py

【目的】
food_paths, dish_root_summary, dish_blacklist を生成する

【処理内容】
1. 前ステップで保存したエッジデータを読み込む
2. BigQuery で food_paths を生成（recursive CTE）
3. dish_root_summary を生成
4. dish_blacklist を自動生成（ancestor ベース）

【使用方法】
python3 1_3_generate_paths_and_summary.py

【注意】
- 事前に 1_2_fetch_and_load_nodes.py を実行してエッジデータを保存しておく必要がある
- BigQuery の recursive CTE で大規模グラフを展開するため、実行に時間がかかる場合がある
"""

import sys
import json
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

# 一時ファイル保存先
TEMP_DIR = Path("/tmp/wikidata_food_graph")
EDGES_FILE = TEMP_DIR / "edges.json"


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Step 3: Generating paths and summary tables")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 1. エッジデータを読み込む
    if not EDGES_FILE.exists():
        logger.error(f"Edges file not found: {EDGES_FILE}")
        logger.error("Please run 1_2_fetch_and_load_nodes.py first")
        sys.exit(1)
    
    logger.info(f"Loading edges from {EDGES_FILE}...")
    with open(EDGES_FILE, 'r') as f:
        edges = json.load(f)
    
    # JSON から tuple に変換
    edges = [(edge[0], edge[1]) for edge in edges]
    logger.info(f"Loaded {len(edges)} edges")
    
    # 2. food_paths を生成
    if edges:
        logger.info("Generating food_paths...")
        bq_loader.generate_food_paths(edges, max_depth=20)
        logger.info("food_paths generated successfully")
    else:
        logger.warning("No edges to generate food_paths")
    
    # 3. dish_root_summary を生成
    logger.info("Generating dish_root_summary...")
    try:
        bq_loader.generate_dish_root_summary()
        logger.info("dish_root_summary generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate dish_root_summary: {e}")
        logger.warning("This is expected if food_paths is empty")
    
    # 4. dish_blacklist を自動生成
    logger.info("Generating dish_blacklist from ancestors...")
    try:
        bq_loader.generate_dish_blacklist_from_ancestors()
        logger.info("dish_blacklist generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate dish_blacklist: {e}")
        logger.warning("This is expected if dish_ancestor_blacklist is empty")
    
    logger.info("=" * 80)
    logger.info("✅ Step 3 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("All steps completed. You can now:")
    logger.info("")
    logger.info("1. Check the generated tables in BigQuery:")
    logger.info(f"   - {GCP_PROJECT}.{BQ_DATASET}.food_roots")
    logger.info(f"   - {GCP_PROJECT}.{BQ_DATASET}.food_nodes_raw")
    logger.info(f"   - {GCP_PROJECT}.{BQ_DATASET}.food_paths")
    logger.info(f"   - {GCP_PROJECT}.{BQ_DATASET}.dish_root_summary")
    logger.info("")
    logger.info("2. Populate dish_ancestor_blacklist with ancestor QIDs to exclude:")
    logger.info(f"   INSERT INTO `{GCP_PROJECT}.{BQ_DATASET}.dish_ancestor_blacklist`")
    logger.info("   (ancestor_qid, reason, created_at) VALUES")
    logger.info("   ('Q5195', 'too_generic', CURRENT_TIMESTAMP());")
    logger.info("")
    logger.info("3. Re-run this script to update dish_blacklist based on ancestors:")
    logger.info("   python3 1_3_generate_paths_and_summary.py")


if __name__ == "__main__":
    main()
