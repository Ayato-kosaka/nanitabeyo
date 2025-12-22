#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_5_publish_features.py

【目的】
結果を dish_category_features_catalog に投入

【処理内容】
1. wikidata_food_llm_labels から結果を取得
2. publish_features.sql で features テーブルに MERGE

【使用方法】
python3 1_5_publish_features.py --dry-run
python3 1_5_publish_features.py
python3 1_5_publish_features.py --config config.yml
"""

import sys
import logging
import argparse
from pathlib import Path

# #575 【設計】lib モジュールをインポート
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
    logger.info("Step 1-5: Publish features to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Dry run: {args.dry_run}")
    
    # BigQuery クライアント初期化
    bq_client = BigQueryClient()
    
    # プレビュー用クエリ（統計確認）
    preview_query = f"""
    SELECT
      CAST(label AS FLOAT64) AS score,
      confidence,
      COUNT(*) as count
    FROM `{config['dataset']}.wikidata_food_llm_labels`
    WHERE task = '{config['task']}'
      AND run_id = '{config['run_id_prefix']}'
      AND label IS NOT NULL
    GROUP BY score, confidence
    ORDER BY score, confidence
    """
    
    logger.info("Previewing data to be published...")
    results = bq_client.execute_query(preview_query)
    
    # 統計表示
    total_count = 0
    score_dist = {}
    for row in results:
        count = row.get("count")
        score = row.get("score")
        confidence = row.get("confidence")
        total_count += count
        score_dist[score] = score_dist.get(score, 0) + count
        logger.info(f"  score={score}, confidence={confidence}: {count} items")
    
    logger.info(f"Total items to publish: {total_count}")
    logger.info(f"Score distribution: {score_dist}")
    
    if args.dry_run:
        logger.info("Dry run mode - skipping actual MERGE")
        logger.info("=" * 80)
        logger.info("✅ Step 1-5 (dry-run) completed successfully!")
        logger.info("=" * 80)
        logger.info("")
        logger.info("To publish for real, run:")
        logger.info("  python3 1_5_publish_features.py")
        return
    
    # publish_features.sql を読み込み
    publish_sql_file = Path(__file__).parent / "sql" / "publish_features.sql"
    with open(publish_sql_file, 'r', encoding='utf-8') as f:
        publish_query = f.read()
    
    # パラメータ設定
    run_id = config['run_id_prefix']
    publish_run_id = run_id + "_publish"
    
    publish_params = {
        "DATASET": config['dataset'],
        "TASK": config['task'],
        "RUN_ID": run_id,
        "PUBLISH_RUN_ID": publish_run_id
    }
    
    # MERGE 実行
    logger.info("Publishing features to dish_category_features_catalog...")
    bq_client.execute_query(publish_query, publish_params)
    
    # 確認クエリ
    verify_query = f"""
    SELECT
      feature_type,
      feature_key,
      COUNT(*) as count,
      AVG(score) as avg_score,
      MIN(score) as min_score,
      MAX(score) as max_score
    FROM `{config['dataset']}.dish_category_features_catalog`
    WHERE feature_type = 'dine_out_orderability'
      AND run_id = '{publish_run_id}'
    GROUP BY feature_type, feature_key
    """
    
    logger.info("Verifying published features...")
    verify_results = bq_client.execute_query(verify_query)
    
    for row in verify_results:
        logger.info(f"  Published: {row.get('feature_type')}:{row.get('feature_key')}")
        logger.info(f"    Count: {row.get('count')}")
        logger.info(f"    Avg score: {row.get('avg_score'):.3f}")
        logger.info(f"    Score range: [{row.get('min_score')}, {row.get('max_score')}]")
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-5 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Published {total_count} features to dish_category_features_catalog")
    logger.info(f"Feature type: dine_out_orderability")
    logger.info(f"Feature key: global")
    logger.info(f"Run ID: {publish_run_id}")
    logger.info("")
    logger.info("Verify in BigQuery:")
    logger.info(f"  SELECT * FROM `{config['dataset']}.dish_category_features_catalog`")
    logger.info(f"  WHERE feature_type = 'dine_out_orderability'")
    logger.info(f"    AND run_id = '{publish_run_id}'")
    logger.info(f"  LIMIT 20;")


if __name__ == "__main__":
    main()
