#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_2_prepare_macro_genre_batch_payload.py

【目的】
items.jsonl を読み込み、20件程度でまとめた Batch payload を JSONL で生成する

【処理内容】
1. items.jsonl を読み込む
2. LLMClient を使用して system prompt を構築
3. 20件ごとにまとめて Batch API リクエストを生成
4. batch_payload.jsonl として出力

【使用方法】
python3 2_2_prepare_macro_genre_batch_payload.py

【入力】
/tmp/wikidata_food_macro_genre/items.jsonl

【出力】
/tmp/wikidata_food_macro_genre/batch_payload.jsonl
"""

import sys
import json
import logging
from pathlib import Path

# #550 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
BATCH_SIZE = 20  # #550 【設計】20件ごとにまとめる

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_macro_genre")
INPUT_FILE = INPUT_DIR / "items.jsonl"
OUTPUT_FILE = INPUT_DIR / "batch_payload.jsonl"


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Step 2-2: Preparing macro_genre batch payload")
    logger.info("=" * 80)
    logger.info(f"Input file: {INPUT_FILE}")
    logger.info(f"Output file: {OUTPUT_FILE}")
    logger.info(f"Batch size: {BATCH_SIZE}")
    
    # 入力ファイルの確認
    if not INPUT_FILE.exists():
        logger.error(f"Input file not found: {INPUT_FILE}")
        logger.error("Please run 2_1_export_macro_genre_label_targets.py first")
        sys.exit(1)
    
    # items.jsonl を読み込む
    logger.info("Reading items...")
    items = []
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    
    logger.info(f"Loaded {len(items)} items")
    
    if not items:
        logger.error("No items found in input file")
        sys.exit(1)
    
    # #550 【設計】LLMClient を初期化（macro_genre タスク用）
    logger.info("Initializing LLM client for macro_genre task...")
    llm_client = LLMClient(task="macro_genre")
    
    # #550 【設計】20件ごとにバッチリクエストを生成
    logger.info(f"Generating batch requests (batch_size={BATCH_SIZE})...")
    batch_requests = []
    
    for i in range(0, len(items), BATCH_SIZE):
        batch_items = items[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        custom_id = f"macro_genre_batch_{batch_num:04d}"
        
        request = llm_client.create_batch_request(batch_items, custom_id)
        batch_requests.append(request)
        
        if batch_num % 100 == 0:
            logger.info(f"Generated {batch_num} batch requests...")
    
    logger.info(f"Generated {len(batch_requests)} batch requests")
    
    # batch_payload.jsonl で出力
    logger.info(f"Writing batch payload to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for request in batch_requests:
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully wrote {len(batch_requests)} batch requests")
    logger.info("=" * 80)
    logger.info("✅ Step 2-2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {OUTPUT_FILE}")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Upload batch_payload.jsonl to OpenAI Batch API")
    logger.info("  2. Wait for batch completion")
    logger.info("  3. Download batch results")
    logger.info("  4. Run: python3 2_3_load_macro_genre_llm_results.py --results-file <path>")


if __name__ == "__main__":
    main()
