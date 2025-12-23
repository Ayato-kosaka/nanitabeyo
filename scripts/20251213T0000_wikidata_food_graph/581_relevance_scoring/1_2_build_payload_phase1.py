#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_build_payload_phase1.py

【目的】
input から Phase1 Batch API 用のペイロードを生成

【処理内容】
1. input.jsonl を読み込む
2. バッチサイズ（config.batch_size）ごとに分割
3. system prompt + user message + tool spec を含む Batch API ペイロードを生成
4. batch_payload_phase1.jsonl に出力

【使用方法】
python3 1_2_build_payload_phase1.py
python3 1_2_build_payload_phase1.py --config config.yml --force
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #581 【設計】lib/prompts モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl, file_exists_or_skip, ensure_directory
from prompts.jp_relevance_scoring_phase1 import (
    build_system_prompt,
    build_user_message,
    build_tool_spec
)

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
            "tool_choice": {"type": "function", "function": {"name": "submit_relevance_scores"}},
            "temperature": 0.0
        }
    }


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Build Phase1 Batch API payload")
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
    logger.info("Step 1-2: Build Phase1 Batch API payload")
    logger.info("=" * 80)
    logger.info(f"Task: {config['task']}")
    logger.info(f"Model: {config['model']}")
    logger.info(f"Batch size: {config['batch_size']}")
    
    # 入力ファイル読み込み
    input_file = Path(config['input_export_path']) / "input.jsonl"
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error("Please run 1_1_export_input.py first")
        sys.exit(1)
    
    items = read_jsonl(input_file)
    logger.info(f"Loaded {len(items)} items from {input_file}")
    
    # 出力先ディレクトリ作成
    payload_dir = Path(config['payload_dir'])
    ensure_directory(payload_dir)
    
    # 出力ファイルパス
    output_file = payload_dir / "batch_payload_phase1.jsonl"
    
    # 既存ファイルチェック
    if file_exists_or_skip(output_file, args.force):
        logger.info("Skipping payload build (file already exists, use --force to overwrite)")
        return
    
    # バッチに分割
    batches = create_batches(items, config['batch_size'])
    
    # ペイロード生成
    logger.info(f"Generating {len(batches)} batch requests...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for i, batch in enumerate(batches):
            custom_id = f"phase1_batch_{i:04d}"
            request = create_batch_request(batch, custom_id, config['model'])
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Generated payload: {output_file}")
    logger.info(f"Total requests: {len(batches)}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_3_submit_batch_phase1.py")


if __name__ == "__main__":
    main()
