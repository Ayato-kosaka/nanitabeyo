#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_prepare_batch_payload.py

【目的】
items.jsonl を読み込み、OpenAI Batch API 用のペイロードを生成する

【処理内容】
1. /tmp/wikidata_food_llm/items.jsonl を読み込む
2. 20件ずつバッチにまとめる
3. Batch API 用の JSONL を生成（1行1リクエスト）

【使用方法】
python3 1_2_prepare_batch_payload.py

【出力】
/tmp/wikidata_food_llm/batch_payload.jsonl
"""

import sys
import json
import logging
from pathlib import Path
from typing import List, Dict

# #548 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_llm")
INPUT_FILE = INPUT_DIR / "items.jsonl"
OUTPUT_FILE = INPUT_DIR / "batch_payload.jsonl"

# バッチサイズ
BATCH_SIZE = 20  # #548 【設計】1リクエストあたり20件


def load_items(filepath: Path) -> List[Dict]:
    """
    items.jsonl を読み込む
    
    Args:
        filepath: items.jsonl のパス
        
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

MAX_DESC_CHARS = 200

def normalize_item(it: Dict) -> Dict:
    out = {
        "item_qid": it.get("item_qid"),
        "label_en": (it.get("label_en") or "").strip(),
    }
    desc = (it.get("desc_en") or "").strip()
    if desc:
        desc = " ".join(desc.split())  # 連続空白・改行を潰す
        out["desc_en"] = desc[:MAX_DESC_CHARS]
    return out


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Step 1-2: Preparing batch payload for OpenAI Batch API")
    logger.info("=" * 80)
    
    # 入力ファイル確認
    if not INPUT_FILE.exists():
        logger.error(f"Input file not found: {INPUT_FILE}")
        logger.error("Please run 1_1_export_unlabeled_nodes.py first")
        return
    
    # アイテム読み込み
    items = load_items(INPUT_FILE)
    
    if not items:
        logger.warning("No items to process")
        return
    
    # アイテム正規化
    items = [normalize_item(it) for it in items]
    
    # バッチに分割
    batches = create_batches(items, BATCH_SIZE)
    
    # #548 【設計】LLM クライアント初期化（menu_blacklist タスク用）
    llm_client = LLMClient(task="menu_blacklist")
    
    # Batch API 用のペイロード生成
    logger.info(f"Generating batch payload...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            custom_id = f"batch_{idx:05d}"
            request = llm_client.create_batch_request(batch, custom_id)
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully generated batch payload: {len(batches)} requests")
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {OUTPUT_FILE}")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Upload batch_payload.jsonl to OpenAI Batch API")
    logger.info("  2. Wait for batch processing to complete")
    logger.info("  3. Download results.jsonl")
    logger.info("  4. Run: python3 1_3_load_llm_results.py --run-id <run_id>")


if __name__ == "__main__":
    main()
