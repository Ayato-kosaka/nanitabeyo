#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_5_publish_features.py

【目的】
Pass1 (+ Pass2) の結果を統合して dish_category_features_catalog に投入

【処理内容】
1. aggregate_expected_value.sql で期待値を計算
2. publish_features.sql で features テーブルに MERGE

【使用方法】
python3 2_5_publish_features.py
python3 2_5_publish_features.py --config config.yml --dry-run
"""

import sys
import logging
import argparse
from pathlib import Path

# #572 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config
from lib.bq import BigQueryClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Publish features to dish_category_features_catalog")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yml",
        help="Config file path (default: config.yml)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Dry run mode (preview only, no actual merge)"
    )
    args = parser.parse_args()
    
    # 設定ファイル読み込み
    config_path = Path(__file__).parent / args.config
    config = load_yaml_config(config_path)
    
    logger.info("=" * 80)
    logger.info("Step 2-5: Publish features to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Dry run: {args.dry_run}")
    
    # BigQuery クライアント初期化
    bq_client = BigQueryClient()
    
    # aggregate_expected_value.sql を読み込み
    aggregate_sql_file = Path(__file__).parent / "sql" / "aggregate_expected_value.sql"
    with open(aggregate_sql_file, 'r', encoding='utf-8') as f:
        aggregate_query = f.read()
    
    # パラメータ設定
    run_id_p1 = config['run_id_prefix'] + "_p1"
    run_id_p2 = config['run_id_prefix'] + "_p2"
    
    aggregate_params = {
        "DATASET": config['dataset'],
        "TASK_PASS1": config['task_pass1'],
        "TASK_PASS2": config['task_pass2'],
        "RUN_ID_PASS1": run_id_p1,
        "RUN_ID_PASS2": run_id_p2
    }
    
    # 期待値プレビュー
    logger.info("Calculating expected values...")
    results = bq_client.execute_query(aggregate_query, aggregate_params)
    
    # 統計表示
    total_count = 0
    score_dist = {}
    for row in results:
        total_count += 1
        score = row.get("expected_score")
        score_dist[score] = score_dist.get(score, 0) + 1
    
    logger.info(f"Expected values calculated: {total_count} items")
    logger.info(f"Score distribution: {score_dist}")
    
    if args.dry_run:
        logger.info("Dry run mode - skipping actual MERGE")
        logger.info("=" * 80)
        logger.info("✅ Step 2-5 (dry-run) completed successfully!")
        logger.info("=" * 80)
        return
    
    # publish_features.sql を読み込み
    publish_sql_file = Path(__file__).parent / "sql" / "publish_features.sql"
    with open(publish_sql_file, 'r', encoding='utf-8') as f:
        publish_query = f.read()
    
    # MERGE パラメータ設定
    publish_run_id = config['run_id_prefix'] + "_publish"
    
    # aggregate_query をサブクエリとして埋め込む
    for key, value in aggregate_params.items():
        placeholder = f"${{{key}}}"
        aggregate_query = aggregate_query.replace(placeholder, str(value))
    
    aggregate_query = aggregate_query.strip().rstrip(";")

    publish_params = {
        "DATASET": config['dataset'],
        "FEATURE_KEY": config['market_key'],
        "PUBLISH_RUN_ID": publish_run_id,
        "MODEL_PASS1": config['model_pass1'],
        "MODEL_PASS2": config['model_pass2'],
        "TASK_PASS1": config['task_pass1'],
        "TASK_PASS2": config['task_pass2'],
        "AGGREGATE_EXPECTED_VALUE_QUERY": aggregate_query
    }
    
    # MERGE 実行
    logger.info("Publishing features to dish_category_features_catalog...")
    stats = bq_client.execute_merge(publish_query, publish_params)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-5 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Published {stats['inserted']} features")
    logger.info(f"Run ID: {publish_run_id}")
    logger.info("")
    logger.info("Verification query:")
    logger.info(f"  SELECT * FROM `{config['dataset']}.dish_category_features_catalog`")
    logger.info(f"  WHERE feature_type='market_salience'")
    logger.info(f"    AND feature_key='{config['market_key']}'")
    logger.info(f"    AND run_id='{publish_run_id}'")
    logger.info(f"  LIMIT 10;")


if __name__ == "__main__":
    main()
