#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_prepare_region_batch_payload.py

【目的】
region_targets JSONL を読み込み、OpenAI Batch API 用のペイロードを生成する

【処理内容】
1. /tmp/wikidata_food_region/region_targets_<market>.jsonl を読み込む
2. 20件ずつバッチにまとめる
3. market に応じた LLMClient（region タスク）を初期化
4. Batch API 用の JSONL を生成（1行1リクエスト）

【使用方法】
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1

【出力】
/tmp/wikidata_food_region/batch_payload_scope_global.jsonl
/tmp/wikidata_food_region/batch_payload_country_jp.jsonl
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_region")

# バッチサイズ
BATCH_SIZE = 20  # #557 【設計】1リクエストあたり20件

# #557 【設計】market 定義
VALID_MARKETS = ["scope:global", "country:JP"]


def load_items(filepath: Path) -> List[Dict]:
    """
    region_targets JSONL を読み込む
    
    Args:
        filepath: region_targets JSONL のパス
        
    Returns:
        アイテムのリスト
    """
    items = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    
    logger.info(f"Loaded {len(items)} items from {filepath}")
    return items


def create_batches(items: List[Dict], batch_size: int) -> List[List[Dict]]:
    """
    アイテムをバッチに分割する
    
    Args:
        items: アイテムのリスト
        batch_size: バッチサイズ
        
    Returns:
        バッチのリスト
    """
    batches = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        batches.append(batch)
    
    logger.info(f"Created {len(batches)} batches (size={batch_size})")
    return batches


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Prepare region batch payload for OpenAI Batch API")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market to prepare payload for (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1-2: Preparing region batch payload for OpenAI Batch API")
    logger.info("=" * 80)
    logger.info(f"Market: {args.market}")
    logger.info(f"Run ID: {args.run_id}")
    
    # 入力ファイル名を決定
    if args.market == "scope:global":
        input_file = INPUT_DIR / "region_targets_scope_global.jsonl"
        output_file = INPUT_DIR / "batch_payload_scope_global.jsonl"
    elif args.market == "country:JP":
        input_file = INPUT_DIR / "region_targets_country_jp.jsonl"
        output_file = INPUT_DIR / "batch_payload_country_jp.jsonl"
    else:
        logger.error(f"Unknown market: {args.market}")
        sys.exit(1)
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error(f"Please run 1_1_export_region_label_targets.py --market {args.market} first")
        sys.exit(1)
    
    # アイテム読み込み
    items = load_items(input_file)
    
    if not items:
        logger.warning("No items to process")
        sys.exit(0)
    
    # バッチに分割
    batches = create_batches(items, BATCH_SIZE)
    
    # #557 【設計】LLM クライアント初期化（region タスク、market_key を指定）
    llm_client = LLMClient(task="region", market_key=args.market)
    
    # Batch API 用のペイロード生成
    logger.info(f"Generating batch payload...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            # #557 【設計】custom_id に run_id を含めて追跡可能にする
            custom_id = f"{args.run_id}_batch_{idx:05d}"
            request = llm_client.create_batch_request(batch, custom_id)
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully generated batch payload: {len(batches)} requests")
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {output_file}")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Upload batch_payload.jsonl to OpenAI Batch API")
    logger.info("  2. Wait for batch processing to complete")
    logger.info("  3. Download results.jsonl")
    logger.info(f"  4. Run: python3 1_3_load_region_llm_results.py --market {args.market} --run-id {args.run_id} --input <results.jsonl>")


if __name__ == "__main__":
    main()
