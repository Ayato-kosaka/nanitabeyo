#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_export_region_label_targets.py

【目的】
dish_category_catalog から region gate ラベリング対象を抽出し、LLM 用入力（JSONL）を作成する

【処理内容】
1. BigQuery から dish_category_catalog 全件（image_url IS NOT NULL）を取得
2. market パラメータに応じて適切な情報を抽出
3. JSONL 形式で出力（1行1アイテム）

【使用方法】
python3 1_1_export_region_label_targets.py --market scope:global
python3 1_1_export_region_label_targets.py --market country:JP

【出力】
/tmp/wikidata_food_region_gate/region_targets_scope_global.jsonl
/tmp/wikidata_food_region_gate/region_targets_country_jp.jsonl
"""

import sys
import json
import logging
import argparse
from pathlib import Path

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
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
OUTPUT_DIR = Path("/tmp/wikidata_food_region_gate")

# market 定義
VALID_MARKETS = ["scope:global", "country:JP"]


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Export region label targets from BigQuery")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market to export targets for (scope:global or country:JP)"
    )
    args = parser.parse_args()
    
    market = args.market
    
    logger.info("=" * 80)
    logger.info("Step 1-1: Exporting region label targets from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {market}")
    
    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    
    # 出力ファイル名決定
    market_safe = market.replace(":", "_")
    output_file = OUTPUT_DIR / f"region_targets_{market_safe}.jsonl"
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # #557 【設計】dish_category_catalog から対象を取得
    logger.info(f"Fetching region label targets for market={market}...")
    items = bq_loader.get_region_label_targets(market)
    
    if not items:
        logger.warning("No items found")
        sys.exit(0)
    
    logger.info(f"Found {len(items)} items")
    
    # JSONL で出力
    logger.info(f"Writing to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(items)} items")
    logger.info("=" * 80)
    logger.info("✅ Step 1-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {output_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_2_prepare_region_batch_payload.py --market {market} --run-id <run_id>")


if __name__ == "__main__":
    main()
