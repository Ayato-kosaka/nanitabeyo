#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_export_macro_genre_label_targets.py

【目的】
#550 macro_genre LLM 分類の対象ノードを BigQuery から取得し、JSONL でエクスポートする

【処理内容】
1. dish_blacklist 未該当の全 dish を取得（macro_genre 付与済みも含む）
2. label_en IS NOT NULL のノードのみを対象
3. JSONL 形式で出力（1行1アイテム）

【使用方法】
python3 2_1_export_macro_genre_label_targets.py

【出力】
/tmp/wikidata_food_llm_macro_genre/items.jsonl
"""

import sys
import json
import logging
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

# 出力先
OUTPUT_DIR = Path("/tmp/wikidata_food_llm_macro_genre")
OUTPUT_FILE = OUTPUT_DIR / "items.jsonl"


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Step 2-1: Exporting macro_genre label targets from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # macro_genre 分類対象ノードを取得
    logger.info("Fetching macro_genre label targets...")
    nodes = bq_loader.get_macro_genre_label_targets()
    
    if not nodes:
        logger.warning("No target nodes found")
        sys.exit(0)
    
    logger.info(f"Found {len(nodes)} target nodes")
    
    # JSONL で出力
    logger.info(f"Writing to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for node in nodes:
            f.write(json.dumps(node, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(nodes)} nodes")
    logger.info("=" * 80)
    logger.info("✅ Step 2-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {OUTPUT_FILE}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 2_2_prepare_macro_genre_batch_payload.py")


if __name__ == "__main__":
    main()
