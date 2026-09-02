#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
9_1_sync_dish_categories.py

【目的】
BigQuery → PostgreSQL: dish_categories テーブルの同期

【処理内容】
1. BigQuery から dish_category_catalog と dish_macro_genre_analysis を取得
2. 画像は manual > analysis > wikimedia の優先順位で代表画像を選定
3. macro_genre_qid を dish_macro_genre_analysis から取得
4. PostgreSQL へ UPSERT
5. BigQuery に存在しないカテゴリは PostgreSQL から物理削除（CASCADE）

【使用方法】
# 通常実行
python3 9_1_sync_dish_categories.py --schema dev

# ドライラン
python3 9_1_sync_dish_categories.py --schema dev --dry-run

# public スキーマ（確認あり）
python3 9_1_sync_dish_categories.py --schema public

【環境変数】
- DATABASE_URL: PostgreSQL 接続文字列（必須）
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values
from google.cloud import bigquery

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


def fetch_dish_categories_from_bq(loader: BigQueryLoader) -> Dict[str, Dict]:
    """
    BigQuery から dish_categories データを取得
    
    Args:
        loader: BigQueryLoader インスタンス
    
    Returns:
        {category_id: category_data} の辞書
    """
    logger.info("Fetching dish_categories from BigQuery...")
    
    # dish_category_catalog と dish_macro_genre_analysis を JOIN
    query = f"""
        WITH ranked_images AS (
        SELECT
            dish_category_id,
            image_url,
            ROW_NUMBER() OVER (
            PARTITION BY dish_category_id
            ORDER BY
                CASE source_type
                WHEN 'manual' THEN 1
                WHEN 'analysis' THEN 2
                WHEN 'wikimedia' THEN 3
                WHEN 'partner' THEN 4
                ELSE 5
                END,
                COALESCE(score, 0) DESC
            ) AS rn
        FROM `{loader.dataset_ref}.dish_category_images`
        ),
        rep_images AS (
        SELECT dish_category_id, image_url
        FROM ranked_images
        WHERE rn = 1
        )
        SELECT
        cat.item_qid as id,
        cat.label_en,
        cat.labels_json as labels,
        COALESCE(rep.image_url, '') as image_url,
        cat.tags,
        TIMESTAMP('1970-01-01 00:00:00+00') as created_at,
        mg.macro_genre_qid
        FROM `{loader.dataset_ref}.dish_category_catalog` cat
        LEFT JOIN rep_images rep
        ON rep.dish_category_id = cat.item_qid
        LEFT JOIN `{loader.dataset_ref}.dish_macro_genre_analysis` mg
        ON cat.item_qid = mg.item_qid
        WHERE cat.item_qid IS NOT NULL
    """
    
    job = loader.client.query(query)
    rows = list(job.result())
    
    categories = {}
    for row in rows:
        category_id = row.id
        categories[category_id] = {
            "id": category_id,
            "label_en": row.label_en,
            "labels": row.labels or "{}",
            "image_url": row.image_url or "",
            "tags": row.tags or [],
            "created_at": row.created_at,
            "macro_genre_qid": row.macro_genre_qid  # dish_macro_genre_analysis から取得
        }
    
    logger.info(f"Fetched {len(categories)} categories from BigQuery")
    return categories

def log_category_references_before_delete(pg_conn, to_delete_ids: set, limit: int = 50) -> int:
    """
    削除予定カテゴリが dishes から参照されているかを集計してログ出しする。
    Returns: 参照されている dishes の総件数
    """
    if not to_delete_ids:
        return 0

    ids = list(to_delete_ids)

    logger.info(f"Checking references for {to_delete_ids} categories scheduled for deletion...")

    # 総参照数
    pg_conn.cursor.execute(
        """
        SELECT COUNT(*) 
        FROM dishes
        WHERE category_id = ANY(%s)
        """,
        (ids,)
    )
    total_refs = pg_conn.cursor.fetchone()[0] or 0

    if total_refs > 0:
        logger.warning(f"⚠️ {len(to_delete_ids)} categories scheduled for deletion are referenced by dishes: {total_refs} dish rows")

        # どのカテゴリが何件参照されているか（上位）
        pg_conn.cursor.execute(
            """
            SELECT category_id, COUNT(*) AS cnt
            FROM dishes
            WHERE category_id = ANY(%s)
            GROUP BY category_id
            ORDER BY cnt DESC
            LIMIT %s
            """,
            (ids, limit)
        )
        rows = pg_conn.cursor.fetchall()
        for cat_id, cnt in rows:
            logger.warning(f"  - category_id={cat_id}: {cnt} dishes")

    return total_refs

def sync_dish_categories(
    loader: BigQueryLoader,
    pg_conn: PostgreSQLConnection,
    dry_run: bool = False
) -> SyncStats:
    """
    dish_categories を同期
    
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
    bq_categories = fetch_dish_categories_from_bq(loader)
    bq_category_ids = set(bq_categories.keys())
    
    # 2. 同期用データ整形
    categories_to_sync = []
    for category_id, cat_data in bq_categories.items():
        categories_to_sync.append({
            "id": category_id,
            "label_en": cat_data["label_en"],
            "labels": cat_data["labels"],
            "image_url": cat_data["image_url"],
            "tags": cat_data["tags"],
            "created_at": cat_data["created_at"],
            "macro_genre_qid": cat_data["macro_genre_qid"],
            "synced_at": synced_at
        })
    
    # 3. PostgreSQL の既存データを取得
    pg_conn.cursor.execute("SELECT id FROM dish_categories")
    pg_category_ids = {row[0] for row in pg_conn.cursor.fetchall()}

    to_delete = pg_category_ids - bq_category_ids
    if to_delete:
        # 事前バリデーション（参照チェック）
        ref_count = log_category_references_before_delete(pg_conn, to_delete, limit=50)

        # 安全のため：参照があるなら削除中止（推奨）
        if ref_count > 0:
            raise RuntimeError(
                f"Refusing to delete {len(to_delete)} dish_categories because they are referenced by {ref_count} dishes. "
                "Investigate before proceeding."
            )

    if dry_run:
        new_ids = bq_category_ids - pg_category_ids
        existing_ids = bq_category_ids & pg_category_ids

        stats.inserted = len(new_ids)
        stats.updated = len(existing_ids)
        stats.deleted = len(to_delete)
        return stats
    
    # 4. UPSERT
    if categories_to_sync:
        logger.info(f"Upserting {len(categories_to_sync)} categories...")
        
        sql = """
            INSERT INTO dish_categories (
                id, label_en, labels, image_url, tags, created_at, macro_genre_qid, synced_at
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                label_en = EXCLUDED.label_en,
                labels = EXCLUDED.labels,
                image_url = EXCLUDED.image_url,
                tags = EXCLUDED.tags,
                macro_genre_qid = EXCLUDED.macro_genre_qid,
                synced_at = EXCLUDED.synced_at
        """
        
        values = [
            (
                cat["id"],
                cat["label_en"],
                cat["labels"],
                cat["image_url"],
                cat["tags"],
                cat["created_at"],
                cat["macro_genre_qid"],
                cat["synced_at"]
            )
            for cat in categories_to_sync
        ]
        
        execute_values(pg_conn.cursor, sql, values)
        pg_conn.conn.commit()
        
        # 統計計算（簡易版）
        new_ids = bq_category_ids - pg_category_ids
        stats.inserted = len(new_ids)
        stats.updated = len(categories_to_sync) - stats.inserted
        
        logger.info(f"✅ Upserted {len(categories_to_sync)} categories")
    
    # 5. 削除処理（BQ に存在しないカテゴリ）
    if to_delete:
        logger.info(f"Deleting {len(to_delete)} categories...")
        
        delete_sql = "DELETE FROM dish_categories WHERE id = ANY(%s)"
        pg_conn.cursor.execute(delete_sql, (list(to_delete),))
        pg_conn.conn.commit()
        
        stats.deleted = len(to_delete)
        logger.info(f"✅ Deleted {len(to_delete)} categories (CASCADE)")
    
    return stats


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description='Sync dish_categories from BigQuery to PostgreSQL'
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
    logger.info("BigQuery → PostgreSQL Sync: dish_categories")
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
            backup_path = backup_table_to_gcs(pg_conn, "dish_categories", args.dry_run)
            if not backup_path:
                raise RuntimeError("Backup failed twice; aborting sync for safety.")
            if backup_path:
                logger.info(f"✅ Backup completed: {backup_path}")
        
        # 同期処理
        stats = sync_dish_categories(loader, pg_conn, args.dry_run)
        
        # 統計出力
        if args.dry_run:
            write_dry_run_summary(stats, "dish_categories", args.output_dir)
        else:
            stats.print_summary("dish_categories")
        
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
