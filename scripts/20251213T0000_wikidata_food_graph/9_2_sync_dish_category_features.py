#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
9_2_sync_dish_category_features.py

【目的】
BigQuery → PostgreSQL: dish_category_features テーブルの同期

【処理内容】
1. BigQuery から dish_category_features_catalog を取得
2. PostgreSQL の dish_category_features を全削除
3. 1 のデータを PostgreSQL に INSERT

【使用方法】
# 通常実行
python3 9_2_sync_dish_category_features.py --schema dev

# ドライラン
python3 9_2_sync_dish_category_features.py --schema dev --dry-run

# public（本番）は対話確認 (y/N) を要求する。GitHub Actions 等の非対話環境では
# input() が即 EOFError になるため、明示的に --yes を渡した場合のみ確認をスキップする。
python3 9_2_sync_dish_category_features.py --schema public --yes

【環境変数】
- DATABASE_URL: PostgreSQL 接続文字列（必須）
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone
from typing import List, Dict
from pathlib import Path
from psycopg2.extras import execute_values

# プロジェクトルートのモジュールをインポート
sys.path.append(str(Path(__file__).parent))
from loader_bigquery import BigQueryLoader
from sync_common import (
    PostgreSQLConnection, SyncStats, backup_table_to_gcs,
    write_dry_run_summary, GCP_PROJECT, BQ_DATASET
)

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def sync_dish_category_features(
    loader: BigQueryLoader,
    pg_conn: PostgreSQLConnection,
    dry_run: bool = False
) -> SyncStats:
    """
    dish_category_features を同期
    
    Args:
        loader: BigQueryLoader インスタンス
        pg_conn: PostgreSQL 接続
        dry_run: ドライラン
    
    Returns:
        統計情報
    """
    stats = SyncStats()
    synced_at = datetime.now(timezone.utc).isoformat()
    
    # 1. BigQuery からデータ取得
    logger.info("Fetching dish_category_features from BigQuery...")
    
    query = f"""
        SELECT
            item_qid as dish_category_id,
            feature_type,
            feature_key,
            score,
        FROM `{loader.dataset_ref}.dish_category_features_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    job = loader.client.query(query)
    rows = list(job.result())
    
    features = [
        {
            "dish_category_id": row.dish_category_id,
            "feature_type": row.feature_type,
            "feature_key": row.feature_key,
            "score": row.score,
            "synced_at": synced_at
        }
        for row in rows
    ]
    
    logger.info(f"Fetched {len(features)} features from BigQuery")
    
    if dry_run:
        logger.info(f"[DRY-RUN] Would sync {len(features)} features")
        stats.inserted = len(features)
        return stats
    
    if not features:
        logger.warning("No features to sync")
        return stats
    
    # 2. 既存データをクリア（全置き換え戦略）
    logger.info("Clearing existing features...")

    with pg_conn.conn:  # ← このブロックが1トランザクション
        with pg_conn.conn.cursor() as cur:
            # 任意：同期中の整合性を優先したいならロック（並列実行や読取りが気になる場合）
            # cur.execute("LOCK TABLE dish_category_features IN EXCLUSIVE MODE")

            cur.execute("SELECT COUNT(*) FROM dish_category_features")
            existing_count = cur.fetchone()[0]

            cur.execute("DELETE FROM dish_category_features")
            stats.deleted = existing_count

            # 3. INSERT
            logger.info(f"Inserting {len(features)} features...")

            sql = """
                INSERT INTO dish_category_features (
                    dish_category_id, feature_type, feature_key, score, synced_at
                ) VALUES %s
            """

            values = [
                (
                    feat["dish_category_id"],
                    feat["feature_type"],
                    feat["feature_key"],
                    feat["score"],
                    feat["synced_at"]
                )
                for feat in features
            ]

            execute_values(cur, sql, values)

    # ここに来た時点で成功なら commit 済み（例外なら rollback 済み）
    stats.inserted = len(features)
    logger.info(f"✅ Inserted {len(features)} features")
    
    return stats


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description='Sync dish_category_features from BigQuery to PostgreSQL'
    )
    parser.add_argument(
        '--schema',
        required=True,
        choices=['public', 'dev'],
        help='PostgreSQL schema (public or dev)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode (no actual changes)'
    )
    parser.add_argument(
        '--output-dir',
        default='/tmp',
        help='Output directory for dry-run summary'
    )
    parser.add_argument(
        '--yes',
        action='store_true',
        help='Skip the interactive (y/N) confirmation for --schema public. '
             'Required for non-interactive environments (e.g. GitHub Actions), '
             'where input() would otherwise raise EOFError. Has no effect for --schema dev.'
    )

    args = parser.parse_args()
    
    # 環境変数チェック
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        sys.exit(1)
    
    logger.info("=" * 80)
    logger.info("BigQuery → PostgreSQL Sync: dish_category_features")
    logger.info("=" * 80)
    logger.info(f"Schema: {args.schema}")
    logger.info(f"Dry-run: {args.dry_run}")
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # PostgreSQL 接続初期化
    pg_conn = PostgreSQLConnection(database_url, args.schema)
    
    # スキーマバリデーション（--yes 指定時のみ public の対話確認をスキップする）
    if not pg_conn.validate_schema(require_confirmation=not args.yes):
        sys.exit(1)
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # PostgreSQL に接続
        pg_conn.connect()
        
        # バックアップ（dry-run でない場合）
        if not args.dry_run:
            backup_path = backup_table_to_gcs(pg_conn, "dish_category_features", args.dry_run)
            if not backup_path:
                raise RuntimeError("Backup failed twice; aborting sync for safety.")
            if backup_path:
                logger.info(f"✅ Backup completed: {backup_path}")
        
        # 同期処理
        stats = sync_dish_category_features(loader, pg_conn, args.dry_run)
        
        # 統計出力
        if args.dry_run:
            write_dry_run_summary(stats, "dish_category_features", args.output_dir)
        else:
            stats.print_summary("dish_category_features")
        
        logger.info("=" * 80)
        logger.info("✅ Sync completed successfully")
        logger.info("=" * 80)
        
    except Exception as e:
        logger.error(f"❌ Sync failed: {e}", exc_info=True)
        sys.exit(1)
    finally:
        pg_conn.close()


if __name__ == "__main__":
    main()
