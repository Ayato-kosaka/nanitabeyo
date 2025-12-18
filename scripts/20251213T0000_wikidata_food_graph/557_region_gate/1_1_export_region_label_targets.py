#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_export_region_label_targets.py

【目的】
dish_category_catalog から全 item_qid を抽出し、
LLM region 判定用の入力（JSONL）を market 別に作成する

【処理内容】
1. BigQuery から dish_category_catalog の全アイテムを取得
2. market に応じて label/desc の優先度を変更
3. JSONL 形式で出力（1行1アイテム）

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


def get_catalog_items(bq_loader: BigQueryLoader, market: str):
    """
    dish_category_catalog から全アイテムを取得
    
    Args:
        bq_loader: BigQueryLoader インスタンス
        market: 'scope:global' または 'country:JP'
        
    Returns:
        アイテムのリスト
    """
    # #557 【設計】LLM に見せる情報量を意図的に制限（安定性・コスト対策）
    sql = f"""
    SELECT
      item_qid,
      label_en,
      desc_en,
      label_ja,
      desc_ja,
      -- aliases から代表数件のみ（en / ja の最初の2件ずつ）
      (
        SELECT STRING_AGG(alias, ', ' LIMIT 4)
        FROM (
          SELECT alias
          FROM UNNEST(
            ARRAY_CONCAT(
              IFNULL(JSON_EXTRACT_ARRAY(aliases_json, '$.en'), []),
              IFNULL(JSON_EXTRACT_ARRAY(aliases_json, '$.ja'), [])
            )
          ) AS alias
          LIMIT 4
        )
      ) AS aliases_sample,
      -- sitelinks の有無（jawiki / enwiki）
      (
        CASE
          WHEN JSON_EXTRACT_SCALAR(sitelinks_json, '$.jawiki') IS NOT NULL THEN 'jawiki'
          ELSE NULL
        END
      ) AS has_jawiki,
      (
        CASE
          WHEN JSON_EXTRACT_SCALAR(sitelinks_json, '$.enwiki') IS NOT NULL THEN 'enwiki'
          ELSE NULL
        END
      ) AS has_enwiki,
      -- roots
      (
        SELECT STRING_AGG(r.kind, ', ')
        FROM UNNEST(roots) AS r
      ) AS roots_str,
      -- tags（depth<=5 の ancestor QID、最大10件）
      (
        SELECT STRING_AGG(tag, ', ' LIMIT 10)
        FROM UNNEST(tags) AS tag
        WHERE tag IS NOT NULL
      ) AS tags_sample
    FROM `{bq_loader.dataset_ref}.dish_category_catalog`
    WHERE label_en IS NOT NULL OR label_ja IS NOT NULL
    ORDER BY item_qid
    """
    
    logger.info(f"Fetching catalog items for market={market}...")
    result = bq_loader.client.query(sql).result()
    
    items = []
    for row in result:
        # #557 【設計】market に応じて優先する言語を切り替え
        item = {
            "item_qid": row.item_qid,
        }
        
        if market == "country:JP":
            # JP market では日本語を優先
            item["label"] = row.label_ja or row.label_en or ""
            item["desc"] = row.desc_ja or row.desc_en or ""
            item["label_en"] = row.label_en or ""
            item["label_ja"] = row.label_ja or ""
        else:
            # global market では英語のみ
            item["label"] = row.label_en or ""
            item["desc"] = row.desc_en or ""
            item["label_en"] = row.label_en or ""
        
        # メタデータ（短く固定フォーマット）
        item["aliases"] = row.aliases_sample or ""
        item["has_jawiki"] = bool(row.has_jawiki)
        item["has_enwiki"] = bool(row.has_enwiki)
        item["roots"] = row.roots_str or ""
        item["tags"] = row.tags_sample or ""
        
        items.append(item)
    
    logger.info(f"Found {len(items)} items")
    return items


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Export region label targets from dish_category_catalog"
    )
    parser.add_argument(
        "--market",
        required=True,
        choices=["scope:global", "country:JP"],
        help="Target market (scope:global or country:JP)"
    )
    
    args = parser.parse_args()
    market = args.market
    
    logger.info("=" * 80)
    logger.info("Step 1-1: Exporting region label targets from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {market}")
    
    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    
    # 出力ファイル名生成
    market_slug = market.replace(":", "_").replace(".", "_")
    output_file = OUTPUT_DIR / f"region_targets_{market_slug}.jsonl"
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # catalog から全アイテムを取得
    items = get_catalog_items(bq_loader, market)
    
    if not items:
        logger.warning("No items found")
        sys.exit(0)
    
    # JSONL で出力
    logger.info(f"Writing to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully exported {len(items)} items")
    logger.info("=" * 80)
    logger.info("✅ Step 1-1 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {output_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_2_prepare_region_batch_payload.py --market {market} --run_id <run_id>")


if __name__ == "__main__":
    main()
