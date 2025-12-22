#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_build_payload.py

【目的】
input から Batch API 用のペイロードを生成

【処理内容】
1. input.jsonl を読み込む
2. バッチサイズ（config.batch_size）ごとに分割
3. system prompt + user message + tool spec を含む Batch API ペイロードを生成
4. batch_payload.jsonl に出力

【使用方法】
python3 1_2_build_payload.py
python3 1_2_build_payload.py --config config.yml --force
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #575 【設計】lib/prompts モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl, file_exists_or_skip, ensure_directory
from prompts.jp_dine_out_orderability import build_system_prompt, build_user_message, build_tool_spec

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def create_batches(items: List[Dict], batch_size: int) -> List[List[Dict]]:
    """
    アイテムをバッチに分割
    
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


def create_batch_request(items: List[Dict], custom_id: str, model: str) -> Dict:
    """
    Batch API 用のリクエストを生成
    
    Args:
        items: アイテムのリスト
        custom_id: カスタムID（リクエスト識別用）
        model: モデル名
        
    Returns:
        Batch API 用のリクエスト辞書
    """
    system_prompt = build_system_prompt()
    user_message = build_user_message(items)
    tool_spec = build_tool_spec(len(items))
    
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "tools": [tool_spec],
            "tool_choice": {
                "type": "function",
                "function": {"name": "submit_dine_out_orderability_decisions"}
            },
            # temperature' does not support 0 with gpt-5-mini
            "temperature": None if model == 'gpt-5-mini' else 0,
        }
    }


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Build batch payload")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yml",
        help="Config file path (default: config.yml)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force overwrite existing files"
    )
    args = parser.parse_args()
    
    # 設定ファイル読み込み
    config_path = Path(__file__).parent / args.config
    config = load_yaml_config(config_path)
    
    logger.info("=" * 80)
    logger.info("Step 1-2: Build batch payload")
    logger.info("=" * 80)
    logger.info(f"Model: {config['model']}")
    logger.info(f"Batch size: {config['batch_size']}")
    
    # 入力ファイルパス
    input_dir = Path(config['input_export_path'])
    input_file = input_dir / "input.jsonl"
    
    # 出力ディレクトリ
    payload_dir = Path(config['payload_dir'])
    ensure_directory(payload_dir)
    
    # 出力ファイルパス
    output_file = payload_dir / "batch_payload.jsonl"
    
    # 既存ファイルチェック
    if file_exists_or_skip(output_file, args.force):
        logger.info("Skipping build (file already exists, use --force to overwrite)")
        return
    
    # 入力データ読み込み
    items = read_jsonl(input_file)
    
    if not items:
        logger.error("No items found in input file")
        return
    
    # バッチに分割
    batches = create_batches(items, config['batch_size'])
    
    # Batch API ペイロード生成
    logger.info(f"Generating batch payload...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            custom_id = f"batch_{idx:05d}"
            request = create_batch_request(batch, custom_id, config['model'])
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Generated {len(batches)} batch requests")
    logger.info(f"Output: {output_file}")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Upload payload to OpenAI Batch API")
    logger.info("  2. Run: python3 1_3_submit_batch.py (or manually submit)")


if __name__ == "__main__":
    main()
