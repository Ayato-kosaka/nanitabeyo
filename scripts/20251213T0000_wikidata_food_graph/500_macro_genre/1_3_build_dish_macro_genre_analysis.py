#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_build_dish_macro_genre_analysis.py

【目的】
macro_genre_whitelist と food_paths を用いて macro_genre を決定し、分析テーブルを生成

【処理内容】
1. 対象は dish_category_catalog の item（＝blacklist 除外済み）に限定
2. food_paths を macro_genre_whitelist と JOIN
3. min depth を求め、候補数で ambiguous 判定
4. CREATE OR REPLACE TABLE dish_macro_genre_analysis AS ...

【出力】
dish_macro_genre_analysis テーブル
- macro_genre_qid（ambiguous なら NULL）
- macro_genre_depth
- macro_genre_ambiguous
- macro_genre_candidates（min depth 全件 + 最大 K 件）
- computed_at（＋任意で whitelist_snapshot_at）

【使用方法】
python3 1_3_build_dish_macro_genre_analysis.py

【注意】
- テーブルは CREATE OR REPLACE で再生成される
- whitelist を更新後、このスクリプトを再実行することで結果が更新される
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
    logger.info("Building dish_macro_genre_analysis table")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # dish_macro_genre_analysis を生成
    logger.info("Generating dish_macro_genre_analysis...")
    bq_loader.generate_dish_macro_genre_analysis()
    logger.info("Successfully generated dish_macro_genre_analysis")
    
    logger.info("=" * 80)
    logger.info("✅ dish_macro_genre_analysis table built successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next steps:")
    logger.info("  - Export candidate stats: python3 1_4_export_macro_genre_candidate_stats.py")
    logger.info("  - Export review CSV: python3 1_5_export_macro_genre_review.py")
    logger.info("")
    logger.info("Note: dish_category_catalog must be built first using:")
    logger.info("  cd .. && python3 3_1_build_dish_category_catalog.py")


if __name__ == "__main__":
    main()
