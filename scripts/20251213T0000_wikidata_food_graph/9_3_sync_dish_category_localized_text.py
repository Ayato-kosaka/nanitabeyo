#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
9_3_sync_dish_category_localized_text.py

【目的】
BigQuery → PostgreSQL: dish_category_localized_text テーブルの同期

【処理内容】
1. BigQuery から dish_category_localized_text_catalog を取得
2. PostgreSQL へ UPSERT

【使用方法】
# 通常実行
python3 9_3_sync_dish_category_localized_text.py --schema dev

# ドライラン
python3 9_3_sync_dish_category_localized_text.py --schema dev --dry-run

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


def sync_dish_category_localized_text(
    loader: BigQueryLoader,
    pg_conn: PostgreSQLConnection,
    dry_run: bool = False
) -> SyncStats:
    """
    dish_category_localized_text を同期（全置換：DELETE→INSERT）
    ※ DELETE と INSERT は同一トランザクションで実行し、途中失敗で空にならないようにする
    """
    stats = SyncStats()
    synced_at = datetime.now(timezone.utc).isoformat()

    # 1. BigQuery からデータ取得
    logger.info("Fetching dish_category_localized_text from BigQuery...")

    query = f"""
        SELECT
            item_qid as dish_category_id,
            locale,
            topic_title,
            tagline
        FROM `{loader.dataset_ref}.dish_category_localized_text_catalog`
        WHERE item_qid IS NOT NULL
    """

    job = loader.client.query(query)
    rows = list(job.result())

    texts = [
        {
            "dish_category_id": row.dish_category_id,
            "locale": row.locale,
            "topic_title": row.topic_title,
            "tagline": row.tagline,
            "synced_at": synced_at
        }
        for row in rows
    ]

    logger.info(f"Fetched {len(texts)} localized texts from BigQuery")

    if dry_run:
        logger.info(f"[DRY-RUN] Would sync {len(texts)} localized texts")
        stats.inserted = len(texts)
        return stats

    if not texts:
        logger.warning("No localized texts to sync")
        return stats

    sql = """
        INSERT INTO dish_category_localized_text (
            dish_category_id, locale, topic_title, tagline, synced_at
        ) VALUES %s
    """

    values = [
        (
            text["dish_category_id"],
            text["locale"],
            text["topic_title"],
            text["tagline"],
            text["synced_at"]
        )
        for text in texts
    ]

    # 2-3. 全置換を 1 トランザクションで実行（途中失敗で空にならない）
    logger.info("Clearing existing localized texts and inserting new ones (single transaction)...")
    with pg_conn.conn:
        with pg_conn.conn.cursor() as cur:
            # 任意：同期中の中途半端を避けたい/二重起動が怖い場合はロック
            # cur.execute("LOCK TABLE dish_category_localized_text IN EXCLUSIVE MODE")

            cur.execute("SELECT COUNT(*) FROM dish_category_localized_text")
            existing_count = cur.fetchone()[0]

            cur.execute("DELETE FROM dish_category_localized_text")
            stats.deleted = existing_count

            logger.info(f"Inserting {len(texts)} localized texts...")
            execute_values(cur, sql, values)

    stats.inserted = len(texts)
    logger.info(f"✅ Inserted {len(texts)} localized texts")
    return stats


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description='Sync dish_category_localized_text from BigQuery to PostgreSQL'
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
    logger.info("BigQuery → PostgreSQL Sync: dish_category_localized_text")
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
            backup_path = backup_table_to_gcs(pg_conn, "dish_category_localized_text", args.dry_run)
            if not backup_path:
                raise RuntimeError("Backup failed twice; aborting sync for safety.")
            if backup_path:
                logger.info(f"✅ Backup completed: {backup_path}")
        
        # 同期処理
        stats = sync_dish_category_localized_text(loader, pg_conn, args.dry_run)
        
        # 統計出力
        if args.dry_run:
            write_dry_run_summary(stats, "dish_category_localized_text", args.output_dir)
        else:
            stats.print_summary("dish_category_localized_text")
        
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
