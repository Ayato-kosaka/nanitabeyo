#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_export_unlabeled_nodes.py

【目的】
dish_blacklist 未該当ノードを BigQuery から取得し、JSONL でエクスポートする

【処理内容】
1. BigQuery から dish_blacklist に含まれていないノードを取得
2. label_en IS NOT NULL のノードのみを対象
3. JSONL 形式で出力（1行1アイテム）

【使用方法】
python3 1_1_export_unlabeled_nodes.py

【出力】
/tmp/wikidata_food_llm/items.jsonl
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

# 出力先
OUTPUT_DIR = Path("/tmp/wikidata_food_llm")
OUTPUT_FILE = OUTPUT_DIR / "items.jsonl"


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Step 1-1: Exporting unlabeled nodes from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # dish_blacklist 未該当ノードを取得
    logger.info("Fetching unlabeled nodes...")
    nodes = bq_loader.get_unlabeled_nodes()
    
    if not nodes:
        logger.warning("No unlabeled nodes found")
        sys.exit(0)
    
    logger.info(f"Found {len(nodes)} unlabeled nodes")
    
    # JSONL で出力
    logger.info(f"Writing to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for node in nodes:
            f.write(json.dumps(node, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(nodes)} nodes")
    logger.info("=" * 80)
    logger.info("✅ Step 1-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {OUTPUT_FILE}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_2_prepare_batch_payload.py")


if __name__ == "__main__":
    main()
