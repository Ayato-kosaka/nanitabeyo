#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
4_1_generate_variants.py

【目的】
BigQuery の dish_category_catalog から variants を生成し、
dish_category_variant_catalog に格納する。

【処理内容】
1. dish_category_catalog から label_en, labels_json, aliases_json を取得
2. variants を正規化・重複排除して生成
3. dish_category_variant_catalog にロード（CREATE OR REPLACE）

【使用方法】
python3 4_1_generate_variants.py

【注意】
- Wikidata への新規アクセスは行わない
- 既存の dish_category_catalog データのみを使用
- テーブルは CREATE OR REPLACE で再生成される
"""

import sys
import json
import logging
import unicodedata
from datetime import datetime, timezone
from typing import List, Dict, Set, Tuple
from pathlib import Path

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


def norm_key(s: str) -> str:
    """
    文字列を正規化（NFKC → 空白圧縮 → 小文字化）
    
    Args:
        s: 正規化する文字列
    
    Returns:
        正規化された文字列
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = " ".join(s.split())
    return s.lower()


def is_bad(s: str) -> bool:
    """
    空または無意味な文字列かどうかを判定
    
    Args:
        s: 判定する文字列
    
    Returns:
        True: 空または無意味, False: 有効
    """
    return (not s) or (s == "") or (s in {"null", "\\n", "\\N"})


def extract_variants_from_json(
    item_qid: str,
    label_en: str,
    labels_json: str,
    aliases_json: str
) -> List[Dict[str, str]]:
    """
    JSON から variants を抽出
    
    Args:
        item_qid: dish_category QID
        label_en: 英語ラベル
        labels_json: 全言語ラベルの JSON 文字列
        aliases_json: 全言語別名の JSON 文字列
    
    Returns:
        variants のリスト [{"surface_form": "...", "source": "..."}, ...]
    """
    variants = []
    seen = set()
    
    # 1) label_en を canonical として追加
    if label_en and not is_bad(label_en):
        surface = norm_key(label_en)
        if surface and surface not in seen:
            seen.add(surface)
            variants.append({
                "surface_form": surface,
                "source": "canonical-label-en"
            })
    
    # 2) labels_json からラベルを追加
    if labels_json:
        try:
            labels = json.loads(labels_json)
            for lang, label_val in labels.items():
                if isinstance(label_val, str) and not is_bad(label_val):
                    surface = norm_key(label_val)
                    if surface and surface not in seen:
                        seen.add(surface)
                        variants.append({
                            "surface_form": surface,
                            "source": "wikidata-label"
                        })
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse labels_json for {item_qid}: {e}")
    
    # 3) aliases_json から別名を追加
    if aliases_json:
        try:
            aliases = json.loads(aliases_json)
            for lang, alias_list in aliases.items():
                if isinstance(alias_list, list):
                    for alias_val in alias_list:
                        if isinstance(alias_val, str) and not is_bad(alias_val):
                            surface = norm_key(alias_val)
                            if surface and surface not in seen:
                                seen.add(surface)
                                variants.append({
                                    "surface_form": surface,
                                    "source": "wikidata-alias"
                                })
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse aliases_json for {item_qid}: {e}")
    
    return variants


def generate_variants(loader: BigQueryLoader) -> None:
    """
    dish_category_catalog から variants を生成し、
    dish_category_variant_catalog に格納
    
    Args:
        loader: BigQueryLoader インスタンス
    """
    logger.info("=" * 80)
    logger.info("Generating variants from dish_category_catalog")
    logger.info("=" * 80)
    
    # 1) dish_category_catalog からデータ取得
    query = f"""
        SELECT
            item_qid,
            label_en,
            labels_json,
            aliases_json
        FROM `{loader.dataset_ref}.dish_category_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    logger.info("Fetching dish_category_catalog data...")
    job = loader.client.query(query)
    rows = list(job.result())
    logger.info(f"Fetched {len(rows)} categories")
    
    # 2) variants を生成
    all_variants = []
    global_seen = set()  # グローバル一意性を保証
    stats = {
        "total_categories": len(rows),
        "total_variants": 0,
        "unique_variants": 0,
        "skipped_duplicates": 0
    }
    
    for row in rows:
        item_qid = row.item_qid
        label_en = row.label_en or ""
        labels_json = row.labels_json or ""
        aliases_json = row.aliases_json or ""
        
        variants = extract_variants_from_json(
            item_qid, label_en, labels_json, aliases_json
        )
        
        stats["total_variants"] += len(variants)
        
        # グローバル一意性チェック（表記揺れは単独一意）
        for variant in variants:
            surface = variant["surface_form"]
            if surface in global_seen:
                stats["skipped_duplicates"] += 1
                continue
            
            global_seen.add(surface)
            stats["unique_variants"] += 1
            all_variants.append({
                "dish_category_id": item_qid,
                "surface_form": surface,
                "source": variant["source"],
                "created_at": datetime.now(timezone.utc).isoformat()
            })
    
    logger.info(f"Generated variants - categories: {stats['total_categories']}, "
                f"total: {stats['total_variants']}, "
                f"unique: {stats['unique_variants']}, "
                f"duplicates: {stats['skipped_duplicates']}")
    
    # 3) dish_category_variant_catalog に格納（CREATE OR REPLACE）
    if not all_variants:
        logger.warning("No variants to load")
        return
    
    table_id = f"{loader.dataset_ref}.dish_category_variant_catalog"
    logger.info(f"Loading {len(all_variants)} variants to {table_id}")
    
    # まず既存テーブルを削除して再作成
    delete_sql = f"DROP TABLE IF EXISTS `{table_id}`"
    loader.execute_sql(delete_sql)
    
    # テーブル作成
    create_sql = f"""
        CREATE TABLE `{table_id}` (
            dish_category_id STRING NOT NULL,
            surface_form     STRING NOT NULL,
            source           STRING NOT NULL,
            created_at       TIMESTAMP NOT NULL
        )
    """
    loader.execute_sql(create_sql)
    
    # データ挿入
    job_config = loader.client.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=[
            {"name": "dish_category_id", "type": "STRING", "mode": "REQUIRED"},
            {"name": "surface_form", "type": "STRING", "mode": "REQUIRED"},
            {"name": "source", "type": "STRING", "mode": "REQUIRED"},
            {"name": "created_at", "type": "TIMESTAMP", "mode": "REQUIRED"},
        ]
    )
    
    job = loader.client.load_table_from_json(
        all_variants,
        table_id,
        job_config=job_config
    )
    job.result()
    
    logger.info(f"✅ Loaded {len(all_variants)} variants to {table_id}")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("BigQuery Variants Generation Script")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # variants 生成
        generate_variants(loader)
        
        logger.info("=" * 80)
        logger.info("✅ Variants generation completed successfully")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"❌ Error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
