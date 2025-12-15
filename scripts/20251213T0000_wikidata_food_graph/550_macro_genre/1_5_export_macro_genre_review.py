#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_5_export_macro_genre_review.py

【目的】
レビュー用に、dish_category_catalog と dish_macro_genre_analysis を JOIN し、CSV 出力する
（曖昧や NULL をフィルタするオプションがあると便利）

【処理内容】
1. dish_category_catalog と dish_macro_genre_analysis を JOIN
2. オプションで曖昧や NULL をフィルタ
3. CSV ファイルに出力

【出力例】
dish_macro_genre_review.csv
- item_qid, label_ja/en
- macro_genre_qid, macro_genre_depth, macro_genre_ambiguous
- macro_genre_candidates（文字列化）
- tags（文字列化 or JSON）

【使用方法】
# 全件出力
python3 1_5_export_macro_genre_review.py

# 曖昧なものだけ出力
python3 1_5_export_macro_genre_review.py --ambiguous-only

# NULL のものだけ出力
python3 1_5_export_macro_genre_review.py --null-only

# 出力先を指定
python3 1_5_export_macro_genre_review.py --output /path/to/output.csv

【注意】
- CSV は UTF-8 で出力される
- candidates と tags は JSON 文字列として出力される
"""

import sys
import logging
import argparse
import csv
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
DEFAULT_OUTPUT = "dish_macro_genre_review.csv"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Export dish macro_genre review data to CSV"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=DEFAULT_OUTPUT,
        help=f"Output CSV file path (default: {DEFAULT_OUTPUT})"
    )
    parser.add_argument(
        "--ambiguous-only",
        action="store_true",
        help="Export only ambiguous items"
    )
    parser.add_argument(
        "--null-only",
        action="store_true",
        help="Export only items with NULL macro_genre_qid"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Exporting dish macro_genre review data")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Output: {args.output}")
    
    if args.ambiguous_only:
        logger.info("Filter: ambiguous only")
    if args.null_only:
        logger.info("Filter: NULL only")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # レビューデータを取得
    logger.info("Fetching review data from BigQuery...")
    review_data = bq_loader.fetch_macro_genre_review_data(
        ambiguous_only=args.ambiguous_only,
        null_only=args.null_only
    )
    
    if not review_data:
        logger.warning("No review data found")
        return
    
    logger.info(f"Found {len(review_data)} items")
    
    # CSV に出力
    logger.info(f"Writing to {args.output}...")
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                'item_qid', 'label_ja', 'label_en',
                'macro_genre_qid', 'macro_genre_depth', 'macro_genre_ambiguous',
                'macro_genre_candidates', 'tags'
            ]
        )
        writer.writeheader()
        writer.writerows(review_data)
    
    logger.info(f"Successfully wrote {len(review_data)} rows to {args.output}")
    logger.info("=" * 80)
    logger.info("✅ Export completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Review the CSV file")
    logger.info("  2. If needed, adjust macro_genre_whitelist")
    logger.info("  3. Re-run: python3 1_3_build_dish_macro_genre_analysis.py")


if __name__ == "__main__":
    main()
