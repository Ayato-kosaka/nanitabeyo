#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_prepare_region_batch_payload.py

【目的】
region_targets JSONL を読み込み、OpenAI Batch API 用のペイロードを生成する

【処理内容】
1. region_targets_*.jsonl を読み込む
2. 20件ずつバッチにまとめる
3. market ごとに system prompt / examples を切り替え
4. Batch API 用の JSONL を生成（1行1リクエスト）

【使用方法】
python3 1_2_prepare_region_batch_payload.py --market scope:global --run_id 20251218T0000_global_v1
python3 1_2_prepare_region_batch_payload.py --market country:JP --run_id 20251218T0100_jp_v1

【出力】
/tmp/wikidata_food_region/batch_payload_scope_global_<run_id>.jsonl
/tmp/wikidata_food_region/batch_payload_country_jp_<run_id>.jsonl
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_region")
OUTPUT_DIR = Path("/tmp/wikidata_food_region")

# バッチサイズ
BATCH_SIZE = 20  # #557 【設計】1リクエストあたり20件

# スクリプトのディレクトリ
SCRIPT_DIR = Path(__file__).parent


def load_examples(market: str) -> List[Dict]:
    """
    教師データを読み込む
    
    Args:
        market: 'scope:global' または 'country:JP'
        
    Returns:
        教師データのリスト
    """
    if market == "country:JP":
        examples_file = SCRIPT_DIR / "llm_examples_region_country_jp.json"
    else:
        examples_file = SCRIPT_DIR / "llm_examples_region_global.json"
    
    with open(examples_file, 'r', encoding='utf-8') as f:
        examples = json.load(f)
    
    logger.info(f"Loaded {len(examples)} examples from {examples_file.name}")
    return examples


def build_system_message(market: str, examples: List[Dict]) -> str:
    """
    system メッセージを構築する（教師データを含む）
    
    Args:
        market: 'scope:global' または 'country:JP'
        examples: 教師データのリスト
        
    Returns:
        system メッセージ文字列
    """
    # #557 【設計】LLM プロンプト - region gate 専用
    system_prompt = f"""You are labeling whether a Wikidata food category should be allowed
to appear in a food suggestion app for a specific market.

Market is provided as: {market}
Examples:
- scope:global
- country:JP

This is a distribution gate (whitelist), not a ranking feature.

Decide one of:
- allow: A real, conversationally common food category/menu item name in that market.
- deny: Not common in that market, too obscure, or not a food category/menu item.
- uncertain: Not enough evidence.

Rules:
- Precision is prioritized. If unsure, choose "uncertain".
- Do not infer popularity beyond the provided evidence.
- Prefer deny for ingredients, cooking methods, place names, or cuisine names.
- Output strict JSON only. No extra text.

Output format:
{{
  "results": [
    {{
      "item_qid": "Qxxxx",
      "decision": "allow|deny|uncertain",
      "confidence": "high|medium|low",
      "reason": "one short sentence"
    }}
  ]
}}

Here are some examples for market={market}:

"""
    
    # 教師データを追加
    for ex in examples:
        ex_str = json.dumps(ex, ensure_ascii=False, separators=(',', ':'))
        system_prompt += f"{ex_str}\n"
    
    system_prompt += "\nNow process the provided items and output only the JSON result."
    
    return system_prompt


def build_user_message(batch: List[Dict], market: str) -> str:
    """
    user メッセージを構築する
    
    Args:
        batch: アイテムのバッチ
        market: 'scope:global' または 'country:JP'
        
    Returns:
        user メッセージ文字列
    """
    user_prompt = f"Market: {market}\n\nItems:\n\n"
    
    for item in batch:
        # #557 【設計】短く固定フォーマットの evidence を生成
        item_str = f"- QID: {item['item_qid']}\n"
        item_str += f"  Label: {item['label']}\n"
        if item.get('desc'):
            item_str += f"  Desc: {item['desc']}\n"
        if item.get('aliases'):
            item_str += f"  Aliases: {item['aliases']}\n"
        if item.get('has_jawiki') or item.get('has_enwiki'):
            wiki_info = []
            if item.get('has_jawiki'):
                wiki_info.append('jawiki')
            if item.get('has_enwiki'):
                wiki_info.append('enwiki')
            item_str += f"  Wiki: {', '.join(wiki_info)}\n"
        
        user_prompt += item_str + "\n"
    
    return user_prompt


def create_batch_request(batch: List[Dict], custom_id: str, market: str, examples: List[Dict]) -> Dict:
    """
    Batch API 用のリクエストを作成
    
    Args:
        batch: アイテムのバッチ
        custom_id: カスタムID
        market: 'scope:global' または 'country:JP'
        examples: 教師データのリスト
        
    Returns:
        Batch API リクエスト辞書
    """
    system_msg = build_system_message(market, examples)
    user_msg = build_user_message(batch, market)
    
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": "gpt-4o-mini",  # #557 【設計】pass1 では gpt-4o-mini を使用
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ]
        }
    }


def load_items(filepath: Path) -> List[Dict]:
    """
    items JSONL を読み込む
    
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


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Prepare region batch payload for OpenAI Batch API"
    )
    parser.add_argument(
        "--market",
        required=True,
        choices=["scope:global", "country:JP"],
        help="Target market (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run_id",
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    
    args = parser.parse_args()
    market = args.market
    run_id = args.run_id
    
    logger.info("=" * 80)
    logger.info("Step 1-2: Preparing region batch payload for OpenAI Batch API")
    logger.info("=" * 80)
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    
    # 入力ファイル名生成
    market_slug = market.replace(":", "_").replace(".", "_")
    input_file = INPUT_DIR / f"region_targets_{market_slug}.jsonl"
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error("Please run 1_1_export_region_label_targets.py first")
        return
    
    # 出力ファイル名生成
    output_file = OUTPUT_DIR / f"batch_payload_{market_slug}_{run_id}.jsonl"
    
    # アイテム読み込み
    items = load_items(input_file)
    
    if not items:
        logger.warning("No items to process")
        return
    
    # バッチに分割
    batches = create_batches(items, BATCH_SIZE)
    
    # 教師データ読み込み
    examples = load_examples(market)
    
    # Batch API 用のペイロード生成
    logger.info(f"Generating batch payload...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            custom_id = f"batch_{market_slug}_{idx:05d}"
            request = create_batch_request(batch, custom_id, market, examples)
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
    logger.info(f"  4. Run: python3 1_3_load_region_llm_results.py --market {market} --run_id {run_id} --input <results.jsonl>")


if __name__ == "__main__":
    main()
