#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_export_region_label_targets.py

【目的】
dish_category_catalog から全アイテムを抽出し、region LLM ラベリング用の JSONL を生成する

【処理内容】
1. BigQuery から dish_category_catalog の全アイテムを取得（labels/desc/aliases/sitelinks/roots/tags）
2. market に応じて適切なフィールドを優先的に使用
3. 短い evidence 形式に整形して JSONL で出力（1行1アイテム）

【使用方法】
python3 1_1_export_region_label_targets.py --market scope:global
python3 1_1_export_region_label_targets.py --market country:JP

【出力】
/tmp/wikidata_food_region/region_targets_scope_global.jsonl
/tmp/wikidata_food_region/region_targets_country_jp.jsonl
"""

import sys
import json
import logging
import argparse
from pathlib import Path

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

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

# 出力先
OUTPUT_DIR = Path("/tmp/wikidata_food_region")

# #557 【設計】market 定義
VALID_MARKETS = ["scope:global", "country:JP"]

# #557 【設計】肥大化防止のための制限
MAX_ALIASES = 3  # aliases は最大3件
MAX_TAGS = 10    # tags は最大10件


def format_item_for_llm(item: dict, market: str) -> dict:
    """
    #557 【設計】LLM 入力用に item を整形する
    
    Args:
        item: BigQuery から取得した item
        market: 'scope:global' or 'country:JP'
        
    Returns:
        整形済み item
    """
    # #557 【設計】market に応じて label/desc を優先
    if market == "country:JP":
        label_ja = (item.get("label_ja") or "").strip()
        label_en = (item.get("label_en") or "").strip()
        desc_ja = (item.get("desc_ja") or "").strip()
        desc_en = (item.get("desc_en") or "").strip()
        
        # JP market では日本語を優先
        out = {
            "item_qid": item.get("item_qid"),
            "label_ja": label_ja if label_ja else None,
            "label_en": label_en if label_en else None,
            "desc_ja": desc_ja if desc_ja else None,
            "desc_en": desc_en if desc_en else None,
        }
    else:
        # global market では英語のみ
        label_en = (item.get("label_en") or "").strip()
        desc_en = (item.get("desc_en") or "").strip()
        
        out = {
            "item_qid": item.get("item_qid"),
            "label_en": label_en if label_en else None,
            "desc_en": desc_en if desc_en else None,
        }
    
    # #557 【設計】aliases_sample（将来対応、今回は NULL なのでスキップ）
    aliases = item.get("aliases_json")
    if aliases:
        # 将来：aliases を解析して最大 MAX_ALIASES 件に制限
        pass
    
    # #557 【設計】sitelinks（将来対応、今回は NULL なのでスキップ）
    sitelinks = item.get("sitelinks_json")
    if sitelinks:
        # 将来：jawiki/enwiki の有無を判定
        pass
    
    # #557 【設計】roots（dish/dessert/drink）
    roots = item.get("roots", [])
    if roots:
        out["roots"] = roots
    
    # #557 【設計】tags_sample（depth<=5 の ancestor、最大 MAX_TAGS 件）
    tags = item.get("tags", [])
    if tags:
        out["tags_sample"] = tags[:MAX_TAGS]
    
    return out


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Export region label targets from BigQuery")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market to export targets for (scope:global or country:JP)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1-1: Exporting region label targets from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {args.market}")
    
    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    
    # 出力ファイル名を決定
    # #557 【設計】market に応じてファイル名を変える
    if args.market == "scope:global":
        output_file = OUTPUT_DIR / "region_targets_scope_global.jsonl"
    elif args.market == "country:JP":
        output_file = OUTPUT_DIR / "region_targets_country_jp.jsonl"
    else:
        logger.error(f"Unknown market: {args.market}")
        sys.exit(1)
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # #557 【設計】dish_category_catalog から全アイテムを取得
    logger.info("Fetching dish_category_catalog for region labeling...")
    items = bq_loader.get_dish_category_catalog_for_region_labeling()
    
    if not items:
        logger.warning("No items found")
        sys.exit(0)
    
    logger.info(f"Found {len(items)} items")
    
    # LLM 入力用に整形
    logger.info("Formatting items for LLM input...")
    formatted_items = [format_item_for_llm(item, args.market) for item in items]
    
    # JSONL で出力
    logger.info(f"Writing to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for item in formatted_items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(formatted_items)} items")
    logger.info("=" * 80)
    logger.info("✅ Step 1-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {output_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_2_prepare_region_batch_payload.py --market {args.market} --run-id <run_id>")


if __name__ == "__main__":
    main()
