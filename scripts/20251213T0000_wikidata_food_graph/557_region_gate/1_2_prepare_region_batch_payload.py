#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_prepare_region_batch_payload.py

【目的】
region_targets_*.jsonl を読み込み、OpenAI Batch API 用のペイロードを生成する

【処理内容】
1. /tmp/wikidata_food_region_gate/region_targets_*.jsonl を読み込む
2. 20件ずつバッチにまとめる
3. Batch API 用の JSONL を生成（1行1リクエスト）
4. tools + tool_choice による構造化出力で JSON破損を防ぐ

【使用方法】
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1

【出力】
/tmp/wikidata_food_region_gate/batch_payload_scope_global.jsonl
/tmp/wikidata_food_region_gate/batch_payload_country_jp.jsonl
"""

import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #557 【設計】region gate 専用モジュールをインポート
from region_gate_prompt import build_system_prompt
from region_gate_schema import build_tool_spec

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_region_gate")
OUTPUT_DIR = INPUT_DIR

# バッチサイズ
BATCH_SIZE = 20  # #557 【設計】1リクエストあたり20件

# market 定義
VALID_MARKETS = ["scope:global", "country:JP"]

# #557 【設計】model 定義（gpt-5-mini を使用）
MODEL_NAME = "gpt-5-mini"


def load_examples(market: str) -> List[Dict]:
    """
    market に応じた教師データを読み込む
    
    Args:
        market: 'scope:global' or 'country:JP'
        
    Returns:
        教師データのリスト
    """
    if market == "scope:global":
        examples_file = Path(__file__).parent / "llm_examples_region_global.json"
    elif market == "country:JP":
        examples_file = Path(__file__).parent / "llm_examples_region_country_jp.json"
    else:
        raise ValueError(f"Unknown market: {market}")
    
    with open(examples_file, 'r', encoding='utf-8') as f:
        examples = json.load(f)
    
    logger.info(f"Loaded {len(examples)} examples from {examples_file}")
    return examples


def load_items(filepath: Path) -> List[Dict]:
    """
    region_targets_*.jsonl を読み込む
    
    Args:
        filepath: region_targets_*.jsonl のパス
        
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
    """
    #557 【設計】アイテムを正規化（連続空白・改行を潰す、desc を最大文字数に制限）
    """
    out = {
        "item_qid": it.get("item_qid"),
        "label_en": (it.get("label_en") or "").strip(),
    }
    
    # market=country:JP の場合は日本語情報も含める
    if "label_ja" in it:
        out["label_ja"] = (it.get("label_ja") or "").strip()
    
    desc_en = (it.get("desc_en") or "").strip()
    if desc_en:
        desc_en = " ".join(desc_en.split())  # 連続空白・改行を潰す
        out["desc_en"] = desc_en[:MAX_DESC_CHARS]
    
    if "desc_ja" in it:
        desc_ja = (it.get("desc_ja") or "").strip()
        if desc_ja:
            desc_ja = " ".join(desc_ja.split())
            out["desc_ja"] = desc_ja[:MAX_DESC_CHARS]
    
    return out


def create_batch_request(items: List[Dict], custom_id: str, system_prompt: str, model: str) -> Dict:
    """
    OpenAI Batch API 用のリクエストを生成
    
    Args:
        items: アイテムのリスト
        custom_id: カスタムID（リクエスト識別用）
        system_prompt: system プロンプト
        model: モデル名
        
    Returns:
        Batch API 用のリクエスト辞書
    """
    # user message を JSON で生成
    user_message = json.dumps({"items": items}, ensure_ascii=False, separators=(",", ":"))
    
    # tool spec 生成
    tool_spec = build_tool_spec(len(items))
    
    # #557 【設計】Batch API リクエスト構築
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "tools": [tool_spec],
            "tool_choice": {"type": "function", "function": {"name": "submit_region_gate_decisions"}},
            "temperature": 0.0,
            "max_tokens": 2000  # #557 【設計】20件前提で適正値
        }
    }


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
    
    market = args.market
    run_id = args.run_id
    
    logger.info("=" * 80)
    logger.info("Step 1-2: Preparing region batch payload for OpenAI Batch API")
    logger.info("=" * 80)
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Model: {MODEL_NAME}")
    
    # 入力ファイル決定
    market_safe = market.replace(":", "_")
    input_file = INPUT_DIR / f"region_targets_{market_safe}.jsonl"
    output_file = OUTPUT_DIR / f"batch_payload_{market_safe}.jsonl"
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error(f"Please run 1_1_export_region_label_targets.py --market {market} first")
        return
    
    # アイテム読み込み
    items = load_items(input_file)
    
    if not items:
        logger.warning("No items to process")
        return
    
    # アイテム正規化
    items = [normalize_item(it) for it in items]
    
    # バッチに分割
    batches = create_batches(items, BATCH_SIZE)
    
    # #557 【設計】教師データ読み込み
    examples = load_examples(market)
    
    # #557 【設計】system prompt 生成（market 別）
    system_prompt = build_system_prompt(market, examples)
    logger.info(f"Generated system prompt for market={market}")
    
    # Batch API 用のペイロード生成
    logger.info(f"Generating batch payload...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            custom_id = f"batch_{idx:05d}"
            request = create_batch_request(batch, custom_id, system_prompt, MODEL_NAME)
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
    logger.info(f"  1. Upload {output_file.name} to OpenAI Batch API")
    logger.info("  2. Wait for batch processing to complete")
    logger.info("  3. Download results.jsonl")
    logger.info(f"  4. Run: python3 1_3_load_region_llm_results.py --market {market} --run-id {run_id} --input results.jsonl")


if __name__ == "__main__":
    main()
