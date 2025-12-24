#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
10_1_sync_bq_to_pg.py

【目的】
BigQuery → PostgreSQL の同期スクリプト
dish_category_catalog など BigQuery のデータを PostgreSQL の Serving DB に同期する。

【処理内容】
1. BigQuery から各カタログテーブルのデータを取得
2. 画像は manual > analysis > wikimedia の優先順位で代表画像を選定
3. PostgreSQL へ UPSERT
   - dish_categories
   - dish_category_features
   - dish_category_localized_text
   - dish_category_variants
4. BigQuery に存在しないカテゴリは PostgreSQL から物理削除（CASCADE）
5. 実行ログを BigQuery に記録

【使用方法】
python3 10_1_sync_bq_to_pg.py

【環境変数】
- DATABASE_URL: PostgreSQL 接続文字列（必須）
"""

import sys
import os
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values

# プロジェクトルートのモジュールをインポート
sys.path.append(str(Path(__file__).parent))
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


class PostgreSQLSyncer:
    """PostgreSQL への同期処理を管理するクラス"""
    
    def __init__(self, database_url: str):
        """
        Args:
            database_url: PostgreSQL 接続文字列
        """
        self.database_url = database_url
        self.conn = None
        self.cursor = None
    
    def connect(self):
        """PostgreSQL に接続"""
        logger.info("Connecting to PostgreSQL...")
        self.conn = psycopg2.connect(self.database_url)
        self.cursor = self.conn.cursor()
        logger.info("✅ Connected to PostgreSQL")
    
    def close(self):
        """PostgreSQL 接続をクローズ"""
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()
        logger.info("Closed PostgreSQL connection")
    
    def upsert_dish_categories(self, categories: List[Dict]) -> Tuple[int, int]:
        """
        dish_categories テーブルに UPSERT
        
        Args:
            categories: カテゴリデータのリスト
        
        Returns:
            (inserted, updated) のタプル
        """
        if not categories:
            logger.warning("No categories to upsert")
            return (0, 0)
        
        logger.info(f"Upserting {len(categories)} categories...")
        
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
                cat.get("macro_genre_qid"),
                cat["synced_at"]
            )
            for cat in categories
        ]
        
        execute_values(self.cursor, sql, values)
        self.conn.commit()
        
        # 挿入/更新数をカウント（簡易版：全件として扱う）
        logger.info(f"✅ Upserted {len(categories)} categories")
        return (len(categories), 0)
    
    def upsert_dish_category_features(self, features: List[Dict]) -> Tuple[int, int]:
        """
        dish_category_features テーブルに UPSERT
        
        Args:
            features: 特徴量データのリスト
        
        Returns:
            (inserted, updated) のタプル
        """
        if not features:
            logger.warning("No features to upsert")
            return (0, 0)
        
        logger.info(f"Upserting {len(features)} features...")
        
        sql = """
            INSERT INTO dish_category_features (
                dish_category_id, feature_type, feature_key, score, source, synced_at
            ) VALUES %s
            ON CONFLICT (dish_category_id, feature_type, feature_key) DO UPDATE SET
                score = EXCLUDED.score,
                source = EXCLUDED.source,
                synced_at = EXCLUDED.synced_at
        """
        
        values = [
            (
                feat["dish_category_id"],
                feat["feature_type"],
                feat["feature_key"],
                feat["score"],
                feat["source"],
                feat["synced_at"]
            )
            for feat in features
        ]
        
        execute_values(self.cursor, sql, values)
        self.conn.commit()
        
        logger.info(f"✅ Upserted {len(features)} features")
        return (len(features), 0)
    
    def upsert_dish_category_localized_text(self, texts: List[Dict]) -> Tuple[int, int]:
        """
        dish_category_localized_text テーブルに UPSERT
        
        Args:
            texts: localized text データのリスト
        
        Returns:
            (inserted, updated) のタプル
        """
        if not texts:
            logger.warning("No localized texts to upsert")
            return (0, 0)
        
        logger.info(f"Upserting {len(texts)} localized texts...")
        
        sql = """
            INSERT INTO dish_category_localized_text (
                dish_category_id, locale, topic_title, tagline, source, synced_at
            ) VALUES %s
            ON CONFLICT (dish_category_id, locale) DO UPDATE SET
                topic_title = EXCLUDED.topic_title,
                tagline = EXCLUDED.tagline,
                source = EXCLUDED.source,
                synced_at = EXCLUDED.synced_at
        """
        
        values = [
            (
                text["dish_category_id"],
                text["locale"],
                text["topic_title"],
                text["tagline"],
                text["source"],
                text["synced_at"]
            )
            for text in texts
        ]
        
        execute_values(self.cursor, sql, values)
        self.conn.commit()
        
        logger.info(f"✅ Upserted {len(texts)} localized texts")
        return (len(texts), 0)
    
    def upsert_dish_category_variants(self, variants: List[Dict]) -> Tuple[int, int]:
        """
        dish_category_variants テーブルに UPSERT
        
        Args:
            variants: variants データのリスト
        
        Returns:
            (inserted, updated) のタプル
        """
        if not variants:
            logger.warning("No variants to upsert")
            return (0, 0)
        
        logger.info(f"Upserting {len(variants)} variants...")
        
        sql = """
            INSERT INTO dish_category_variants (
                dish_category_id, surface_form, source, created_at
            ) VALUES %s
            ON CONFLICT (surface_form) DO UPDATE SET
                dish_category_id = EXCLUDED.dish_category_id,
                source = EXCLUDED.source
        """
        
        values = [
            (
                var["dish_category_id"],
                var["surface_form"],
                var["source"],
                var["created_at"]
            )
            for var in variants
        ]
        
        execute_values(self.cursor, sql, values)
        self.conn.commit()
        
        logger.info(f"✅ Upserted {len(variants)} variants")
        return (len(variants), 0)
    
    def delete_removed_categories(self, bq_category_ids: set) -> int:
        """
        BigQuery に存在しないカテゴリを PostgreSQL から削除（CASCADE）
        
        Args:
            bq_category_ids: BigQuery に存在するカテゴリIDのセット
        
        Returns:
            削除した件数
        """
        logger.info("Checking for removed categories...")
        
        # PostgreSQL の既存カテゴリを取得
        self.cursor.execute("SELECT id FROM dish_categories")
        pg_category_ids = {row[0] for row in self.cursor.fetchall()}
        
        # 削除対象を計算
        to_delete = pg_category_ids - bq_category_ids
        
        if not to_delete:
            logger.info("No categories to delete")
            return 0
        
        logger.info(f"Deleting {len(to_delete)} categories...")
        
        # CASCADE 削除
        delete_sql = "DELETE FROM dish_categories WHERE id = ANY(%s)"
        self.cursor.execute(delete_sql, (list(to_delete),))
        self.conn.commit()
        
        logger.info(f"✅ Deleted {len(to_delete)} categories (CASCADE)")
        return len(to_delete)


def select_representative_image(loader: BigQueryLoader, category_id: str) -> Optional[str]:
    """
    カテゴリの代表画像を優先順位に基づいて選定
    優先順位: manual > analysis > wikimedia
    
    Args:
        loader: BigQueryLoader インスタンス
        category_id: dish_category QID
    
    Returns:
        代表画像URL、なければ None
    """
    query = f"""
        SELECT image_url, source_type
        FROM `{loader.dataset_ref}.dish_category_images`
        WHERE dish_category_id = @category_id
        ORDER BY
            CASE source_type
                WHEN 'manual' THEN 1
                WHEN 'analysis' THEN 2
                WHEN 'wikimedia' THEN 3
                WHEN 'partner' THEN 4
                ELSE 5
            END,
            COALESCE(score, 0) DESC
        LIMIT 1
    """
    
    job_config = loader.client.QueryJobConfig(
        query_parameters=[
            loader.client.ScalarQueryParameter("category_id", "STRING", category_id)
        ]
    )
    
    job = loader.client.query(query, job_config=job_config)
    rows = list(job.result())
    
    if rows:
        return rows[0].image_url
    return None


def sync_from_bq_to_pg(
    loader: BigQueryLoader,
    syncer: PostgreSQLSyncer
) -> Dict:
    """
    BigQuery → PostgreSQL の同期処理
    
    Args:
        loader: BigQueryLoader インスタンス
        syncer: PostgreSQLSyncer インスタンス
    
    Returns:
        統計情報の辞書
    """
    stats = {
        "categories_synced": 0,
        "features_synced": 0,
        "localized_texts_synced": 0,
        "variants_synced": 0,
        "categories_deleted": 0,
        "start_time": datetime.now(timezone.utc),
        "end_time": None
    }
    
    synced_at = datetime.now(timezone.utc).isoformat()
    
    # 1) dish_categories を同期
    logger.info("=" * 80)
    logger.info("Syncing dish_categories...")
    logger.info("=" * 80)
    
    categories_query = f"""
        SELECT
            item_qid as id,
            label_en,
            labels_json as labels,
            image_url,
            tags,
            TIMESTAMP('1970-01-01 00:00:00+00') as created_at
        FROM `{loader.dataset_ref}.dish_category_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    job = loader.client.query(categories_query)
    categories_rows = list(job.result())
    
    # 画像の代表選定と整形
    categories = []
    bq_category_ids = set()
    
    for row in categories_rows:
        category_id = row.id
        bq_category_ids.add(category_id)
        
        # 画像の代表選定（manual > analysis > wikimedia）
        representative_image = select_representative_image(loader, category_id)
        if not representative_image:
            representative_image = row.image_url or ""
        
        categories.append({
            "id": category_id,
            "label_en": row.label_en,
            "labels": row.labels or "{}",
            "image_url": representative_image,
            "tags": row.tags or [],
            "created_at": row.created_at,
            "macro_genre_qid": None,  # BigQuery に macro_genre があれば追加
            "synced_at": synced_at
        })
    
    syncer.upsert_dish_categories(categories)
    stats["categories_synced"] = len(categories)
    
    # 2) dish_category_features を同期
    logger.info("=" * 80)
    logger.info("Syncing dish_category_features...")
    logger.info("=" * 80)
    
    features_query = f"""
        SELECT
            item_qid as dish_category_id,
            feature_type,
            feature_key,
            score,
            source
        FROM `{loader.dataset_ref}.dish_category_features_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    job = loader.client.query(features_query)
    features_rows = list(job.result())
    
    features = [
        {
            "dish_category_id": row.dish_category_id,
            "feature_type": row.feature_type,
            "feature_key": row.feature_key,
            "score": row.score,
            "source": row.source,
            "synced_at": synced_at
        }
        for row in features_rows
    ]
    
    syncer.upsert_dish_category_features(features)
    stats["features_synced"] = len(features)
    
    # 3) dish_category_localized_text を同期
    logger.info("=" * 80)
    logger.info("Syncing dish_category_localized_text...")
    logger.info("=" * 80)
    
    texts_query = f"""
        SELECT
            item_qid as dish_category_id,
            locale,
            topic_title,
            tagline,
            source
        FROM `{loader.dataset_ref}.dish_category_localized_text_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    job = loader.client.query(texts_query)
    texts_rows = list(job.result())
    
    texts = [
        {
            "dish_category_id": row.dish_category_id,
            "locale": row.locale,
            "topic_title": row.topic_title,
            "tagline": row.tagline,
            "source": row.source,
            "synced_at": synced_at
        }
        for row in texts_rows
    ]
    
    syncer.upsert_dish_category_localized_text(texts)
    stats["localized_texts_synced"] = len(texts)
    
    # 4) dish_category_variants を同期
    logger.info("=" * 80)
    logger.info("Syncing dish_category_variants...")
    logger.info("=" * 80)
    
    variants_query = f"""
        SELECT
            dish_category_id,
            surface_form,
            source,
            created_at
        FROM `{loader.dataset_ref}.dish_category_variant_catalog`
        WHERE dish_category_id IS NOT NULL
    """
    
    job = loader.client.query(variants_query)
    variants_rows = list(job.result())
    
    variants = [
        {
            "dish_category_id": row.dish_category_id,
            "surface_form": row.surface_form,
            "source": row.source,
            "created_at": row.created_at
        }
        for row in variants_rows
    ]
    
    syncer.upsert_dish_category_variants(variants)
    stats["variants_synced"] = len(variants)
    
    # 5) 削除されたカテゴリを物理削除
    logger.info("=" * 80)
    logger.info("Deleting removed categories...")
    logger.info("=" * 80)
    
    deleted_count = syncer.delete_removed_categories(bq_category_ids)
    stats["categories_deleted"] = deleted_count
    
    stats["end_time"] = datetime.now(timezone.utc)
    
    return stats


def log_sync_to_bq(loader: BigQueryLoader, stats: Dict) -> None:
    """
    同期ログを BigQuery に記録
    
    Args:
        loader: BigQueryLoader インスタンス
        stats: 統計情報
    """
    logger.info("=" * 80)
    logger.info("Logging sync results to BigQuery...")
    logger.info("=" * 80)
    
    # ログテーブルが存在しない場合は作成
    log_table_id = f"{loader.dataset_ref}.pg_sync_logs"
    
    create_log_table_sql = f"""
        CREATE TABLE IF NOT EXISTS `{log_table_id}` (
            sync_id          STRING NOT NULL,
            start_time       TIMESTAMP NOT NULL,
            end_time         TIMESTAMP NOT NULL,
            categories_synced INT64 NOT NULL,
            features_synced  INT64 NOT NULL,
            localized_texts_synced INT64 NOT NULL,
            variants_synced  INT64 NOT NULL,
            categories_deleted INT64 NOT NULL,
            status           STRING NOT NULL,
            error_message    STRING
        )
    """
    
    loader.execute_sql(create_log_table_sql)
    
    # ログ挿入
    sync_id = stats["start_time"].strftime("%Y%m%dT%H%M%S")
    
    insert_log_sql = f"""
        INSERT INTO `{log_table_id}` (
            sync_id, start_time, end_time, categories_synced, features_synced,
            localized_texts_synced, variants_synced, categories_deleted, status, error_message
        ) VALUES (
            '{sync_id}',
            TIMESTAMP('{stats["start_time"].isoformat()}'),
            TIMESTAMP('{stats["end_time"].isoformat()}'),
            {stats["categories_synced"]},
            {stats["features_synced"]},
            {stats["localized_texts_synced"]},
            {stats["variants_synced"]},
            {stats["categories_deleted"]},
            'success',
            NULL
        )
    """
    
    loader.execute_sql(insert_log_sql)
    logger.info(f"✅ Logged sync to BigQuery (sync_id: {sync_id})")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("BigQuery → PostgreSQL Sync Script")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # 環境変数チェック
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        sys.exit(1)
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # PostgreSQL Syncer 初期化
    syncer = PostgreSQLSyncer(database_url)
    
    try:
        # PostgreSQL に接続
        syncer.connect()
        
        # 同期処理
        stats = sync_from_bq_to_pg(loader, syncer)
        
        # ログ記録
        log_sync_to_bq(loader, stats)
        
        # 統計表示
        logger.info("=" * 80)
        logger.info("✅ Sync completed successfully")
        logger.info("=" * 80)
        logger.info(f"Categories synced: {stats['categories_synced']}")
        logger.info(f"Features synced: {stats['features_synced']}")
        logger.info(f"Localized texts synced: {stats['localized_texts_synced']}")
        logger.info(f"Variants synced: {stats['variants_synced']}")
        logger.info(f"Categories deleted: {stats['categories_deleted']}")
        logger.info(f"Duration: {(stats['end_time'] - stats['start_time']).total_seconds():.2f}s")
        logger.info("=" * 80)
        
    except Exception as e:
        logger.error(f"❌ Sync failed: {e}", exc_info=True)
        sys.exit(1)
    finally:
        syncer.close()


if __name__ == "__main__":
    main()
