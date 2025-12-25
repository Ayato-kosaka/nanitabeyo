#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
4_2_process_images.py

【目的】
dish_category_catalog の image_url を元に、
dish_category_images に wikimedia ソースの画像候補を投入する。

【処理内容】
1. dish_category_catalog から item_qid, image_url を取得
2. image_url を Wikimedia Commons の実体URLに変換（resolve_commons_url.py ロジックを参考）
3. dish_category_images に source_type='wikimedia' として投入

【使用方法】
python3 4_2_process_images.py

【注意】
- Wikidata への新規アクセスは行わない
- 既存の dish_category_catalog.image_url のみを使用
- テーブルは CREATE OR REPLACE で再生成される
"""

import sys
import re
import hashlib
import urllib.parse
import unicodedata
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict
from pathlib import Path
from google.cloud import bigquery

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


def extract_title(image_raw: str) -> Optional[str]:
    """
    URL からファイル名を抽出
    
    Args:
        image_raw: Wikidata の画像URL（Special:FilePath など）
    
    Returns:
        ファイル名、抽出できない場合は None
    """
    if not image_raw:
        return None
    
    s = image_raw.strip()
    u = urllib.parse.unquote(s)
    
    # 1) Special:FilePath/XXXX の形式
    m = re.search(r"Special:FilePath/([^?&#]+)", u, flags=re.IGNORECASE)
    if m:
        return m.group(1)
    
    # 2) upload.wikimedia.org の原寸画像
    m = re.search(r"/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/([^/?#]+)$", u)
    if m:
        return m.group(1)
    
    # 3) サムネイル (thumb) URL
    m = re.search(r"/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/([^/?#]+)/", u)
    if m:
        return m.group(1)
    
    # 4) URL末尾のファイル名っぽい部分を保険で拾う
    m = re.search(r"/([^/?#]+)$", u)
    if m:
        return m.group(1)
    
    return None


def canonize_filename(title: str) -> Optional[str]:
    """
    MediaWiki ファイル名の正規化
    
    Args:
        title: ファイル名
    
    Returns:
        正規化されたファイル名、不正な場合は None
    """
    if not title:
        return None
    
    t = urllib.parse.unquote(title.strip())
    t = t.replace(" ", "_")
    t = unicodedata.normalize("NFC", t)
    
    if t:
        t = t[:1].upper() + t[1:]
    
    if "/" in t or "\\" in t:
        return None
    
    return t


def generate_commons_url_from_title(filename: str) -> Optional[str]:
    """
    ファイル名から Wikimedia Commons の実体URLを生成
    
    Args:
        filename: ファイル名
    
    Returns:
        実体URL、生成できない場合は None
    """
    fn = canonize_filename(filename)
    if not fn:
        return None
    
    md5 = hashlib.md5(fn.encode("utf-8")).hexdigest()
    d1, d2 = md5[0], md5[0:2]
    enc = urllib.parse.quote(fn)
    
    return f"https://upload.wikimedia.org/wikipedia/commons/{d1}/{d2}/{enc}"


def process_images(loader: BigQueryLoader) -> None:
    """
    dish_category_catalog の image_url を処理し、
    dish_category_images に投入
    
    Args:
        loader: BigQueryLoader インスタンス
    """
    logger.info("=" * 80)
    logger.info("Processing images from dish_category_catalog")
    logger.info("=" * 80)
    
    # 1) dish_category_catalog からデータ取得
    query = f"""
        SELECT
            item_qid,
            image_url
        FROM `{loader.dataset_ref}.dish_category_catalog`
        WHERE item_qid IS NOT NULL
            AND image_url IS NOT NULL
            AND image_url != ''
    """
    
    logger.info("Fetching dish_category_catalog data...")
    job = loader.client.query(query)
    rows = list(job.result())
    logger.info(f"Fetched {len(rows)} categories with image_url")
    
    # 2) 画像URLを処理
    images = []
    stats = {
        "total": len(rows),
        "resolved": 0,
        "failed": 0
    }
    
    for row in rows:
        item_qid = row.item_qid
        image_raw = row.image_url
        
        # ファイル名抽出
        title = extract_title(image_raw)
        if not title or title.upper() == "NULL":
            stats["failed"] += 1
            continue
        
        # 実体URL生成
        resolved_url = generate_commons_url_from_title(title)
        if not resolved_url:
            stats["failed"] += 1
            continue
        
        stats["resolved"] += 1
        images.append({
            "dish_category_id": item_qid,
            "image_url": resolved_url,
            "source_type": "wikimedia",
            "source_ref": "P18",  # Wikidata property for image
            "score": None,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    logger.info(f"Processed images - total: {stats['total']}, "
                f"resolved: {stats['resolved']}, failed: {stats['failed']}")
    
    # 3) dish_category_images に格納（CREATE OR REPLACE）
    if not images:
        logger.warning("No images to load")
        return
    
    table_id = f"{loader.dataset_ref}.dish_category_images"
    logger.info(f"Loading {len(images)} images to {table_id}")
    
    # まず既存テーブルを削除して再作成
    delete_sql = f"DROP TABLE IF EXISTS `{table_id}`"
    loader.execute_sql(delete_sql)
    
    # テーブル作成
    create_sql = f"""
        CREATE TABLE `{table_id}` (
            dish_category_id STRING NOT NULL,
            image_url        STRING NOT NULL,
            source_type      STRING NOT NULL,
            source_ref       STRING,
            score            FLOAT64,
            created_at       TIMESTAMP NOT NULL
        )
    """
    loader.execute_sql(create_sql)
    
    # データ挿入
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=[
            {"name": "dish_category_id", "type": "STRING", "mode": "REQUIRED"},
            {"name": "image_url", "type": "STRING", "mode": "REQUIRED"},
            {"name": "source_type", "type": "STRING", "mode": "REQUIRED"},
            {"name": "source_ref", "type": "STRING", "mode": "NULLABLE"},
            {"name": "score", "type": "FLOAT", "mode": "NULLABLE"},
            {"name": "created_at", "type": "TIMESTAMP", "mode": "REQUIRED"},
        ]
    )
    
    job = loader.client.load_table_from_json(
        images,
        table_id,
        job_config=job_config
    )
    job.result()
    
    logger.info(f"✅ Loaded {len(images)} images to {table_id}")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("BigQuery Images Processing Script")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # 画像処理
        process_images(loader)
        
        logger.info("=" * 80)
        logger.info("✅ Images processing completed successfully")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"❌ Error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
