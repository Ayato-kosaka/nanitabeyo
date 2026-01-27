#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_common.py

【目的】
BQ→PG 同期スクリプト共通機能

【機能】
- PostgreSQL 接続管理
- GCS バックアップ
- スキーマバリデーション
- 統計出力
"""

import os
import sys
import logging
import psycopg2
from datetime import datetime, timezone
from typing import Dict, Optional
from google.cloud import storage
from io import StringIO
import csv
import time
import psycopg2

logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
GCS_BUCKET = "nanitabeyo-private"
GCS_BACKUP_PREFIX = "system/PostgreSQL/csv_export"


class SyncStats:
    """同期統計情報"""
    
    def __init__(self):
        self.inserted = 0
        self.updated = 0
        self.deleted = 0
        self.skipped = 0
    
    def to_dict(self) -> Dict:
        return {
            "inserted": self.inserted,
            "updated": self.updated,
            "deleted": self.deleted,
            "skipped": self.skipped,
            "total": self.inserted + self.updated + self.deleted
        }
    
    def print_summary(self, table_name: str):
        """統計サマリーを出力"""
        print(f"\n{'='*80}")
        print(f"📊 同期統計 - {table_name}")
        print(f"{'='*80}")
        print(f"  ✅ 挿入: {self.inserted:,} 件")
        print(f"  🔄 更新: {self.updated:,} 件")
        print(f"  ❌ 削除: {self.deleted:,} 件")
        print(f"  ⏭️  スキップ: {self.skipped:,} 件")
        print(f"  📈 合計: {self.inserted + self.updated + self.deleted:,} 件")
        print(f"{'='*80}\n")


class PostgreSQLConnection:
    """PostgreSQL 接続管理"""
    
    def __init__(self, database_url: str, schema: str = "dev"):
        """
        Args:
            database_url: PostgreSQL 接続文字列
            schema: スキーマ名 (public または dev)
        """
        self.database_url = database_url
        self.schema = schema
        self.conn = None
        self.cursor = None
    
    def validate_schema(self, require_confirmation: bool = False) -> bool:
        """
        スキーマをバリデーション
        
        Args:
            require_confirmation: public の場合に確認を求めるか
        
        Returns:
            バリデーション成功: True, 失敗: False
        """
        if self.schema not in ["public", "dev"]:
            logger.error(f"❌ Invalid schema: {self.schema}. Must be 'public' or 'dev'")
            return False
        
        if self.schema == "public" and require_confirmation:
            print(f"\n{'='*80}")
            print(f"⚠️  警告: public スキーマに対する実行")
            print(f"{'='*80}")
            print(f"  本番環境 (public スキーマ) への同期を実行します。")
            print(f"  この操作はデータベースを変更します。")
            print(f"\n  続行しますか? (y/N): ", end="")
            
            response = input().strip().lower()
            if response != 'y':
                logger.info("実行をキャンセルしました")
                return False
        
        return True
    
    def connect(self):
        """PostgreSQL に接続"""
        logger.info(f"Connecting to PostgreSQL (schema: {self.schema})...")
        connect_kwargs = {
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        }
        self.conn = psycopg2.connect(self.database_url, **connect_kwargs)
        self.cursor = self.conn.cursor()
        
        # スキーマを設定
        self.cursor.execute(f"SET search_path TO {self.schema}")
        self.conn.commit()
        
        logger.info(f"✅ Connected to PostgreSQL (schema: {self.schema})")
    
    def close(self):
        """PostgreSQL 接続をクローズ"""
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()
        logger.info("Closed PostgreSQL connection")


def backup_table_to_gcs(
    pg_conn: PostgreSQLConnection,
    table_name: str,
    dry_run: bool = False
) -> Optional[str]:
    """
    PostgreSQL テーブルを GCS にバックアップ
    
    Args:
        pg_conn: PostgreSQL 接続
        table_name: テーブル名
        dry_run: ドライラン (実際にはアップロードしない)
    
    Returns:
        バックアップファイルのGCSパス、失敗時は None
    """
    def _run_once() -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        gcs_dir = f"{GCS_BACKUP_PREFIX}/{timestamp}"
        gcs_path = f"gs://{GCS_BUCKET}/{gcs_dir}/{table_name}.csv"

        logger.info(f"Backing up {table_name} to {gcs_path}...")

        if dry_run:
            logger.info(f"[DRY-RUN] Would backup {table_name} to {gcs_path}")
            return gcs_path

        # ★共有カーソルは使わない（巻き添え防止）
        with pg_conn.conn.cursor() as cur:
            cur.execute(f"SELECT * FROM {table_name}")
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]

        csv_buffer = StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow(columns)
        writer.writerows(rows)
        csv_data = csv_buffer.getvalue()

        storage_client = storage.Client(project=GCP_PROJECT)
        bucket = storage_client.bucket(GCS_BUCKET)
        blob = bucket.blob(f"{gcs_dir}/{table_name}.csv")
        blob.upload_from_string(csv_data, content_type='text/csv')

        logger.info(f"✅ Backed up {len(rows)} rows to {gcs_path}")
        return gcs_path

    try:
        return _run_once()

    except Exception as e:
        msg = str(e)
        retriable = (
            "SSL SYSCALL error: EOF detected" in msg
            or "server closed the connection unexpectedly" in msg
            or "cursor already closed" in msg
            or isinstance(e, psycopg2.OperationalError)
            or isinstance(e, psycopg2.InterfaceError)
        )

        logger.error(f"❌ Failed to backup {table_name}: {e}", exc_info=True)

        if not retriable:
            return None

        # 1回だけリトライ（新規接続）
        logger.warning(f"🔁 Retrying backup {table_name} once with a fresh connection...")
        try:
            try:
                pg_conn.close()
            except Exception:
                pass
            pg_conn.connect()
            time.sleep(0.5)
            return _run_once()
        except Exception as e2:
            logger.error(f"❌ Backup retry failed for {table_name}: {e2}", exc_info=True)
            return None


def write_dry_run_summary(stats: SyncStats, table_name: str, output_path: str):
    """
    ドライラン統計を /tmp/ に出力
    
    Args:
        stats: 統計情報
        table_name: テーブル名
        output_path: 出力ファイルパス
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"{output_path}/sync_{table_name}_{timestamp}.txt"
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(f"{'='*80}\n")
        f.write(f"ドライラン統計 - {table_name}\n")
        f.write(f"{'='*80}\n")
        f.write(f"実行時刻: {timestamp}\n")
        f.write(f"挿入予定: {stats.inserted:,} 件\n")
        f.write(f"更新予定: {stats.updated:,} 件\n")
        f.write(f"削除予定: {stats.deleted:,} 件\n")
        f.write(f"スキップ: {stats.skipped:,} 件\n")
        f.write(f"合計操作: {stats.inserted + stats.updated + stats.deleted:,} 件\n")
        f.write(f"{'='*80}\n")
    
    logger.info(f"✅ Dry-run summary written to {filename}")
    stats.print_summary(table_name)
