git#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_export_macro_genre_label_targets.py

【目的】
dish_blacklist 未該当の全 dish（13,888件）を抽出し、LLM 用入力（JSONL）を作成する

【処理内容】
1. BigQuery から dish_blacklist に含まれていない全ノードを取得
2. macro_genre が既に付いているものも含める
3. JSONL 形式で出力（1行1アイテム）

【使用方法】
python3 2_1_export_macro_genre_label_targets.py

【出力】
/tmp/wikidata_food_macro_genre/items.jsonl
"""

import sys
import json
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

# 出力先
OUTPUT_DIR = Path("/tmp/wikidata_food_macro_genre")
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
    
    # #550 【設計】dish_blacklist 未該当の全 dish を取得（macro_genre 付与済み含む）
    logger.info("Fetching all dishes for macro_genre labeling...")
    dishes = bq_loader.get_all_dishes_for_macro_genre_labeling()
    
    if not dishes:
        logger.warning("No dishes found")
        sys.exit(0)
    
    logger.info(f"Found {len(dishes)} dishes")
    
    # JSONL で出力
    logger.info(f"Writing to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for dish in dishes:
            f.write(json.dumps(dish, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(dishes)} dishes")
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
