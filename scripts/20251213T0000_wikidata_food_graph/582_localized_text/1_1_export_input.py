#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】Pass1: Step 1 - 入力データエクスポート

BigQuery から dish_category_catalog を抽出し、locale × item のクロス集計で出力
"""

import sys
import logging
import json
from pathlib import Path
import yaml

# #582 【設計】親ディレクトリを sys.path に追加
sys.path.insert(0, str(Path(__file__).parent))

from lib.bq import BigQueryClient
from lib.io import write_jsonl, ensure_dir

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR / "config.yml"
SQL_DIR = SCRIPT_DIR / "sql"


def load_config():
    """config.yml を読み込み"""
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def parse_aliases_json(aliases_json_str: str, max_aliases: int = 5) -> list:
    """
    aliases_json から上位N件を抽出
    
    Args:
        aliases_json_str: JSON文字列
        max_aliases: 最大件数
        
    Returns:
        別名のリスト
    """
    if not aliases_json_str:
        return []
    
    try:
        aliases_dict = json.loads(aliases_json_str)
        # #582 【設計】各言語から最大N件抽出
        all_aliases = []
        for lang_aliases in aliases_dict.values():
            if isinstance(lang_aliases, list):
                all_aliases.extend(lang_aliases)
        
        return all_aliases[:max_aliases]
    except:
        return []


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Pass1 Step 1-1: Exporting input data from BigQuery")
    logger.info("=" * 80)
    
    # config 読み込み
    config = load_config()
    dataset = config["dataset"]
    max_items = config.get("max_items")
    max_desc_chars = config.get("max_desc_chars", 200)
    max_aliases = config.get("max_aliases", 5)
    input_export_dir = Path(config["paths"]["input_export_dir"])
    
    # 出力ディレクトリ作成
    ensure_dir(input_export_dir)
    output_file = input_export_dir / "p1_input.jsonl"
    
    logger.info(f"Dataset: {dataset}")
    logger.info(f"Max items: {max_items or 'ALL'}")
    logger.info(f"Output: {output_file}")
    
    # SQL 読み込み
    sql_file = SQL_DIR / "p1_export_input.sql"
    with open(sql_file, 'r', encoding='utf-8') as f:
        sql_template = f.read()
    
    # #582 【設計】LIMIT 句の生成
    limit_clause = f"LIMIT {max_items}" if max_items else ""
    
    # BigQuery クライアント初期化
    bq_client = BigQueryClient(GCP_PROJECT, dataset.split('.')[1])
    
    # データ抽出
    logger.info("Fetching data from BigQuery...")
    items = bq_client.export_input(sql_template, {
        "dataset": dataset,
        "limit_clause": limit_clause
    })
    
    if not items:
        logger.warning("No items found")
        sys.exit(0)
    
    logger.info(f"Found {len(items)} items")
    
    # #582 【設計】データ整形（description truncate, aliases 抽出）
    formatted_items = []
    for item in items:
        desc = item.get("description", "") or ""
        if desc and len(desc) > max_desc_chars:
            desc = desc[:max_desc_chars]
        
        aliases_top = parse_aliases_json(
            item.get("aliases_json", ""),
            max_aliases
        )
        
        formatted_items.append({
            "item_qid": item["item_qid"],
            "locale": item["locale"],
            "label": item.get("label", ""),
            "description": desc,
            "aliases_top": aliases_top
        })
    
    # JSONL で出力
    write_jsonl(output_file, formatted_items)
    
    logger.info("=" * 80)
    logger.info("✅ Pass1 Step 1-1 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"\nOutput file: {output_file}")
    logger.info(f"\nNext step:\n  python3 1_2_build_payload.py")


if __name__ == "__main__":
    main()
