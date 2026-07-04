#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
main.py

【注意】
このスクリプトは簡易的な一括実行ルートですが、標準の実行ルートは 1_1, 1_2, 1_3 の段階実行です。
#741 以降、1_2_fetch_and_load_nodes.py は food_roots テーブル駆動に移行しており、
main.py は旧来の動作（ハードコード FOOD_ROOTS）を維持しています。

推奨実行方法:
  python3 1_1_create_tables.py
  python3 1_2_fetch_and_load_nodes.py
  python3 1_3_generate_paths_and_summary.py

【目的】
Wikidata から料理・飲み物のグラフ構造を取得し、BigQuery に構造化する

【処理概要】
1. BigQuery migration を実行してテーブルを作成
2. Wikidata から food_nodes_raw 相当のデータを取得
3. BigQuery にノードデータをロード
4. Wikidata から親子エッジ（P31/P279）を取得
5. BigQuery で food_paths を生成（recursive CTE）
6. dish_root_summary を生成
7. dish_blacklist を自動生成（ancestor ベース）

【使用方法】
# 環境変数設定
export GCP_PROJECT="food-scroll"
export BQ_DATASET="nanitabeyo_logs_dev"  # または nanitabeyo_logs_prod

# スクリプト実行
python3 main.py

# オプション: ノード数制限（開発用）
python3 main.py --limit 1000

【注意】
- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかる
- GCP 認証が必要（gcloud auth application-default login）
"""

import os
import sys
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

# FOOD_ROOTS 定数
FOOD_ROOTS = [
    ("Q746549", "dish"),              # dish（料理）
    ("Q8495", "dessert"),             # dessert（デザート）
    ("Q40050", "beverage"),           # beverage（飲み物）
    ("Q154", "alcoholic_beverage"),   # alcoholic beverage（アルコール飲料）
    ("Q659563", "snack"),             # snack（スナック）
    ("Q182940", "confectionery"),     # confectionery（菓子）
    ("Q8486", "coffee"),              # coffee（コーヒー）
    ("Q4006", "tea"),                 # tea（茶）
]


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Wikidata food graph extraction to BigQuery")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of nodes to fetch (for development)"
    )
    parser.add_argument(
        "--skip-migration",
        action="store_true",
        help="Skip migration execution (tables already exist)"
    )
    parser.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Skip fetching nodes from Wikidata (use existing data)"
    )
    parser.add_argument(
        "--skip-paths",
        action="store_true",
        help="Skip generating food_paths"
    )
    args = parser.parse_args()
    
    # 環境変数チェック
    project_id = os.environ.get("GCP_PROJECT")
    dataset_id = os.environ.get("BQ_DATASET")
    
    if not project_id or not dataset_id:
        logger.error("GCP_PROJECT and BQ_DATASET environment variables are required")
        logger.error("Example: export GCP_PROJECT=food-scroll BQ_DATASET=nanitabeyo_logs_dev")
        sys.exit(1)
    
    logger.info(f"Starting Wikidata food graph extraction")
    logger.info(f"Project: {project_id}, Dataset: {dataset_id}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(project_id, dataset_id)
    
    # 1. Migration 実行
    if not args.skip_migration:
        logger.info("Step 1: Executing migration...")
        migration_file = Path(__file__).parent.parent.parent / "infra" / "big-query" / "migration" / "20251213T0000_create_wikidata_food_tables.sql"
        
        if not migration_file.exists():
            logger.error(f"Migration file not found: {migration_file}")
            sys.exit(1)
        
        bq_loader.execute_migration(str(migration_file))
        logger.info("Migration completed")
    else:
        logger.info("Step 1: Skipping migration (--skip-migration)")
    
    # 2. Wikidata からノードデータを取得
    if not args.skip_fetch:
        logger.info("Step 2: Fetching food nodes from Wikidata...")
        wikidata_client = WikidataClient()
        
        root_qids = [qid for qid, _ in FOOD_ROOTS]
        nodes = wikidata_client.fetch_food_nodes(root_qids, limit=args.limit)
        
        if not nodes:
            logger.error("No nodes fetched from Wikidata")
            sys.exit(1)
        
        logger.info(f"Fetched {len(nodes)} nodes")
        
        # 3. BigQuery にノードデータをロード
        logger.info("Step 3: Loading nodes to BigQuery...")
        bq_loader.load_food_nodes(nodes)
        logger.info("Nodes loaded successfully")
        
        # 4. 親子エッジを取得
        logger.info("Step 4: Fetching parent edges from Wikidata...")
        node_qids = [node["item_qid"] for node in nodes]
        edges = wikidata_client.fetch_parent_edges(node_qids)
        
        if not edges:
            logger.warning("No edges fetched from Wikidata")
        else:
            logger.info(f"Fetched {len(edges)} edges")
        
        # 5. food_paths を生成
        if not args.skip_paths and edges:
            logger.info("Step 5: Generating food_paths...")
            bq_loader.generate_food_paths(edges, max_depth=20)
            logger.info("food_paths generated successfully")
        elif args.skip_paths:
            logger.info("Step 5: Skipping food_paths generation (--skip-paths)")
        else:
            logger.warning("Step 5: No edges to generate food_paths")
    else:
        logger.info("Step 2-5: Skipping fetch and paths (--skip-fetch)")
    
    # 6. dish_root_summary を生成
    logger.info("Step 6: Generating dish_root_summary...")
    try:
        bq_loader.generate_dish_root_summary()
        logger.info("dish_root_summary generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate dish_root_summary: {e}")
        logger.warning("This is expected if food_paths is empty")
    
    # 7. dish_blacklist を自動生成
    logger.info("Step 7: Generating dish_blacklist from ancestors...")
    try:
        bq_loader.generate_dish_blacklist_from_ancestors()
        logger.info("dish_blacklist generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate dish_blacklist: {e}")
        logger.warning("This is expected if dish_ancestor_blacklist is empty")
    
    logger.info("=" * 80)
    logger.info("Wikidata food graph extraction completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next steps:")
    logger.info("1. Check the generated tables in BigQuery:")
    logger.info(f"   - {project_id}.{dataset_id}.food_roots")
    logger.info(f"   - {project_id}.{dataset_id}.food_nodes_raw")
    logger.info(f"   - {project_id}.{dataset_id}.food_paths")
    logger.info(f"   - {project_id}.{dataset_id}.dish_root_summary")
    logger.info("")
    logger.info("2. Populate dish_ancestor_blacklist with ancestor QIDs to exclude:")
    logger.info(f"   INSERT INTO `{project_id}.{dataset_id}.dish_ancestor_blacklist`")
    logger.info("   (ancestor_qid, reason, created_at) VALUES")
    logger.info("   ('Q5195', 'too_generic', CURRENT_TIMESTAMP());")
    logger.info("")
    logger.info("3. Re-run this script to update dish_blacklist based on ancestors:")
    logger.info("   python3 main.py --skip-fetch --skip-paths")


if __name__ == "__main__":
    main()
