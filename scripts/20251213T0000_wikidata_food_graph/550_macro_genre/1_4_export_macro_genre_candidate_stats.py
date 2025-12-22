#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_export_macro_genre_candidate_stats.py

【目的】
whitelist 作成の材料として、祖先分布（whitelist 候補）を CSV 出力する

【処理内容】
1. food_paths から祖先の出現頻度を集計
2. dish_blacklist を除外した dish を対象とする
3. 各祖先について、何件の dish がその祖先を持つかを集計
4. food_nodes_raw から label_ja, label_en を取得
5. 例示として数件の dish を example_items に含める
6. CSV ファイルに出力

【出力例】
macro_genre_candidate_stats.csv
- ancestor_qid
- label_ja, label_en
- hit_count（何件の dish がその祖先を持つか）
- example_items（数件、QID と label）

【使用方法】
python3 1_4_export_macro_genre_candidate_stats.py

# 出力先を指定
python3 1_4_export_macro_genre_candidate_stats.py --output /path/to/output.csv

【注意】
- CSV は UTF-8 で出力される
- hit_count が多い順にソートされる
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
DEFAULT_OUTPUT = "macro_genre_candidate_stats.csv"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Export macro_genre candidate stats to CSV"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=DEFAULT_OUTPUT,
        help=f"Output CSV file path (default: {DEFAULT_OUTPUT})"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Exporting macro_genre candidate stats")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Output: {args.output}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 候補統計を取得
    logger.info("Fetching candidate stats from BigQuery...")
    stats = bq_loader.fetch_macro_genre_candidate_stats()
    
    if not stats:
        logger.warning("No stats found")
        return
    
    logger.info(f"Found {len(stats)} candidates")
    
    # CSV に出力
    logger.info(f"Writing to {args.output}...")
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=['ancestor_qid', 'label_ja', 'label_en', 'hit_count', 'example_items']
        )
        writer.writeheader()
        writer.writerows(stats)
    
    logger.info(f"Successfully wrote {len(stats)} rows to {args.output}")
    logger.info("=" * 80)
    logger.info("✅ Export completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Review the CSV file")
    logger.info("  2. Manually update macro_genre_whitelist in BigQuery")
    logger.info("  3. Re-run: python3 1_3_build_dish_macro_genre_analysis.py")


if __name__ == "__main__":
    main()
