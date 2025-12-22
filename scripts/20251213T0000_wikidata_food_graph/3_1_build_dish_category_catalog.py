#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_1_build_dish_category_catalog.py

【目的】
blacklist 除外済み集合を対象に、dish_category_catalog を生成（再生成可能）

【処理内容】
1. food_nodes_raw から dish ノードを取得
2. dish_blacklist を除外
3. labels/desc を付与（Wikidata 由来、food_nodes_raw から取得）
4. image_url を付与（今回はスコープ外、NULL）
5. tags は food_paths を参照し depth<=5 の祖先を配列化して格納
6. CREATE OR REPLACE TABLE dish_category_catalog AS ...

【使用方法】
python3 3_1_build_dish_category_catalog.py

【注意】
- テーブルは CREATE OR REPLACE で再生成される
- image_url は今回のスコープでは NULL（将来拡張可能）
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
    logger.info("Building dish_category_catalog table")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # dish_category_catalog を生成
    logger.info("Generating dish_category_catalog...")
    bq_loader.generate_dish_category_catalog()
    logger.info("Successfully generated dish_category_catalog")
    
    logger.info("=" * 80)
    logger.info("✅ dish_category_catalog table built successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  cd 550_macro_genre && python3 1_3_build_dish_macro_genre_analysis.py")


if __name__ == "__main__":
    main()
