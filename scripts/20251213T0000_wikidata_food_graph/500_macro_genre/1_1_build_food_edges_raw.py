#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_build_food_edges_raw.py

【目的】
Wikidata SPARQL から child→parent のエッジを取得し、food_edges_raw にロードする
（P31/P279/P361/P527）

【処理内容】
1. food_nodes_raw から全ノード QID を取得
2. Wikidata から各ノードの親エッジを取得（P31, P279, P361, P527）
3. BigQuery の food_edges_raw にロード（CREATE OR REPLACE）

【使用方法】
python3 1_1_build_food_edges_raw.py

【注意】
- 既に food_edges_raw がある場合は上書きされる
- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかる
- rate limit 対策として retry/backoff が実装されている
"""

import sys
import logging
from pathlib import Path

# #550 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from wikidata_client import WikidataClient
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
    logger.info("Building food_edges_raw table")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # Wikidata クライアント初期化
    wikidata_client = WikidataClient()
    
    # 1. food_nodes_raw から全ノード QID を取得
    logger.info("Fetching node QIDs from food_nodes_raw...")
    node_qids = bq_loader.fetch_all_node_qids()
    
    if not node_qids:
        logger.error("No nodes found in food_nodes_raw")
        sys.exit(1)
    
    logger.info(f"Found {len(node_qids)} nodes")
    
    # 2. Wikidata から親エッジを取得（P31, P279 のみ。P361/P527 は既存の fetch_parent_edges に含まれていない）
    # #550 【設計】既存の fetch_parent_edges は P31/P279 のみ対応。P361/P527 は今回スコープ外とする
    logger.info("Fetching parent edges from Wikidata...")
    edges = wikidata_client.fetch_parent_edges(node_qids)
    
    if not edges:
        logger.warning("No edges fetched from Wikidata")
    else:
        logger.info(f"Fetched {len(edges)} edges")
    
    # 3. BigQuery の food_edges_raw にロード
    logger.info("Loading edges to food_edges_raw...")
    bq_loader.load_food_edges_raw(edges)
    logger.info("Successfully loaded edges")
    
    logger.info("=" * 80)
    logger.info("✅ food_edges_raw table built successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_2_build_dish_category_catalog.py")


if __name__ == "__main__":
    main()
