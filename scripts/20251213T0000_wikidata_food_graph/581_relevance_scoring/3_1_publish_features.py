#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_1_publish_features.py

【目的】
最終スコアを dish_category_features_catalog に投入

【処理内容】
1. config.yml を読み込む
2. publish_features.sql を実行（Phase2 優先、deny 除外）
3. 投入件数を確認

【使用方法】
python3 3_1_publish_features.py
python3 3_1_publish_features.py --config config.yml --dry-run
"""

import sys
import logging
import argparse
from pathlib import Path

# #581 【設計】lib モジュールをインポート
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
        help="Dry run mode (preview only, no actual publish)"
    )
    args = parser.parse_args()
    
    # 設定ファイル読み込み
    config_path = Path(__file__).parent / args.config
    config = load_yaml_config(config_path)
    
    logger.info("=" * 80)
    logger.info("Step 3-1: Publish features to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Dataset: {config['dataset']}")
    logger.info(f"Task: {config['task']}")
    logger.info(f"Final run_id: {config['final_run_id']}")
    logger.info(f"Dry run: {args.dry_run}")
    
    # BigQuery クライアント初期化
    bq_client = BigQueryClient()
    
    # Dry run: 投入対象を確認
    if args.dry_run:
        logger.info("")
        logger.info("=" * 80)
        logger.info("DRY RUN MODE - Preview only")
        logger.info("=" * 80)
        
        # 投入対象のプレビュー
        preview_query = f"""
        WITH phase_priority AS (
          SELECT
            item_qid,
            feature_type,
            feature_key,
            score,
            confidence,
            reason,
            phase,
            ROW_NUMBER() OVER (
              PARTITION BY item_qid, feature_type, feature_key
              ORDER BY 
                CASE phase WHEN 'phase2' THEN 1 ELSE 2 END,
                created_at DESC
            ) AS priority
          FROM `{config['dataset']}.wikidata_food_llm_feature_scores`
          WHERE task = '{config['task']}'
            AND run_id LIKE '{config['run_id_prefix']}%'
            AND confidence != 'deny'
        )
        SELECT
          phase,
          feature_type,
          COUNT(*) as count
        FROM phase_priority
        WHERE priority = 1
        GROUP BY phase, feature_type
        ORDER BY phase, feature_type
        """
        
        results = bq_client.execute_query(preview_query)
        
        logger.info("")
        logger.info("Preview of features to be published:")
        logger.info("")
        
        total_count = 0
        for row in results:
            phase = row['phase']
            feature_type = row['feature_type']
            count = row['count']
            total_count += count
            logger.info(f"  {phase:8s} | {feature_type:12s} | {count:6d} rows")
        
        logger.info("")
        logger.info(f"Total rows to be published: {total_count}")
        logger.info("")
        logger.info("To actually publish, run without --dry-run flag:")
        logger.info("  python3 3_1_publish_features.py")
        
        return
    
    # 本番投入
    logger.info("")
    logger.info("Publishing features to dish_category_features_catalog...")
    
    # SQL クエリ読み込み
    sql_file = Path(__file__).parent / "sql" / "publish_features.sql"
    with open(sql_file, 'r', encoding='utf-8') as f:
        query = f.read()
    
    # パラメータ置換
    query = query.replace('${DATASET}', config['dataset'])
    query = query.replace('${TASK}', config['task'])
    query = query.replace('${RUN_ID_PREFIX}', config['run_id_prefix'])
    query = query.replace('${FINAL_RUN_ID}', config['final_run_id'])
    
    # クエリ実行
    logger.info("Executing MERGE query...")
    bq_client.execute_merge(query)
    
    # 投入件数を確認
    check_query = f"""
    SELECT
      feature_type,
      COUNT(*) as count
    FROM `{config['dataset']}.dish_category_features_catalog`
    WHERE run_id = '{config['final_run_id']}'
    GROUP BY feature_type
    ORDER BY feature_type
    """
    
    results = bq_client.execute_query(check_query)
    
    logger.info("=" * 80)
    logger.info("✅ Step 3-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Published features:")
    
    total_count = 0
    for row in results:
        feature_type = row['feature_type']
        count = row['count']
        total_count += count
        logger.info(f"  {feature_type:12s}: {count:6d} rows")
    
    logger.info("")
    logger.info(f"Total published rows: {total_count}")
    logger.info("")
    logger.info("=" * 80)
    logger.info("All steps completed!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Relevance scoring has been successfully published.")
    logger.info(f"Run ID: {config['final_run_id']}")


if __name__ == "__main__":
    main()
