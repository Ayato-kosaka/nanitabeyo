#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_fetch_and_load_nodes.py

【目的】
Wikidata から料理・飲み物のノード情報を取得し、BigQuery にロードする

【処理内容】
1. Wikidata から food_roots に基づいてノードを取得
   - ?item (P31|P279)* ?root を満たすノードを対象
   - ラベル（日本語・英語）と説明を取得
2. BigQuery の food_nodes_raw にロード
3. 親子エッジ（P31, P279）を取得
4. 一時ファイルにエッジデータを保存（次のステップで使用）

【使用方法】
# 全件取得（時間がかかる）
python3 1_2_fetch_and_load_nodes.py

# ノード数を制限（開発・テスト用）
python3 1_2_fetch_and_load_nodes.py --limit 1000

【注意】
- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかる
- rate limit 対策として retry/backoff が実装されている
"""

import sys
import json
import logging
import argparse
from pathlib import Path

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

# FOOD_ROOTS 定数
FOOD_ROOTS = [
    ("Q746549",   "dish"),
    ("Q192874",   "noodle"),
    ("Q18593264", "rice_dish"),
    ("Q16266745", "flour_based_food"),
    ("Q182940",   "dessert"),
    ("Q40050",    "drink")
]

# 一時ファイル保存先
TEMP_DIR = Path("/tmp/wikidata_food_graph")
EDGES_FILE = TEMP_DIR / "edges.json"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Fetch and load Wikidata food nodes")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of nodes to fetch (for development)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 2: Fetching and loading nodes from Wikidata")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    if args.limit:
        logger.info(f"Limit: {args.limit} nodes")
    
    # 一時ディレクトリ作成
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    
    # Wikidata クライアント初期化
    wikidata_client = WikidataClient()
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 1. Wikidata からノードデータを取得
    logger.info("Fetching food nodes from Wikidata...")
    root_qids = [qid for qid, _ in FOOD_ROOTS]
    nodes = wikidata_client.fetch_food_nodes(root_qids, limit=args.limit)
    
    if not nodes:
        logger.error("No nodes fetched from Wikidata")
        sys.exit(1)
    
    logger.info(f"Fetched {len(nodes)} nodes")
    
    # 2. BigQuery にノードデータをロード
    logger.info("Loading nodes to BigQuery...")
    bq_loader.load_food_nodes(nodes)
    logger.info("Nodes loaded successfully")
    
    # 3. 親子エッジを取得
    logger.info("Fetching parent edges from Wikidata...")
    node_qids = [node["item_qid"] for node in nodes]
    edges = wikidata_client.fetch_parent_edges(node_qids)
    
    if not edges:
        logger.warning("No edges fetched from Wikidata")
    else:
        logger.info(f"Fetched {len(edges)} edges")
    
    # 4. エッジデータを一時ファイルに保存
    logger.info(f"Saving edges to {EDGES_FILE}...")
    with open(EDGES_FILE, 'w') as f:
        json.dump(edges, f)
    logger.info("Edges saved successfully")
    
    logger.info("=" * 80)
    logger.info("✅ Step 2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_3_generate_paths_and_summary.py")


if __name__ == "__main__":
    main()
