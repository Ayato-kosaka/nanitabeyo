#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_submit_batch.py

【目的】
Batch API にペイロードを投入

【処理内容】
1. batch_payload.jsonl を OpenAI にアップロード
2. バッチジョブを作成
3. batch_id をファイルに保存

【使用方法】
python3 1_3_submit_batch.py
python3 1_3_submit_batch.py --config config.yml
"""

import sys
import os
import logging
import argparse
from pathlib import Path

# #575 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, ensure_directory
from lib.batch_api import BatchAPIClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Submit batch to OpenAI Batch API")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yml",
        help="Config file path (default: config.yml)"
    )
    args = parser.parse_args()
    
    # 設定ファイル読み込み
    config_path = Path(__file__).parent / args.config
    config = load_yaml_config(config_path)
    
    logger.info("=" * 80)
    logger.info("Step 1-3: Submit batch to OpenAI Batch API")
    logger.info("=" * 80)
    
    # OpenAI API キー取得
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.error("OPENAI_API_KEY environment variable not set")
        logger.error("Please set: export OPENAI_API_KEY='sk-...'")
        return
    
    # ペイロードファイルパス
    payload_dir = Path(config['payload_dir'])
    payload_file = payload_dir / "batch_payload.jsonl"
    
    if not payload_file.exists():
        logger.error(f"Payload file not found: {payload_file}")
        logger.error("Please run: python3 1_2_build_payload.py")
        return
    
    # 結果ディレクトリ作成
    results_dir = Path(config['results_dir'])
    ensure_directory(results_dir)
    
    # Batch API クライアント初期化
    batch_client = BatchAPIClient(api_key)
    
    # ファイルアップロード
    logger.info(f"Uploading payload file: {payload_file}")
    file_id = batch_client.upload_file(payload_file)
    logger.info(f"File uploaded: {file_id}")
    
    # バッチジョブ作成
    run_id = config['run_id_prefix']
    metadata = {
        "task": config['task'],
        "run_id": run_id
    }
    
    logger.info(f"Creating batch job...")
    batch_id = batch_client.create_batch(file_id, metadata)
    logger.info(f"Batch created: {batch_id}")
    
    # batch_id をファイルに保存
    batch_id_file = results_dir / "batch_id.txt"
    with open(batch_id_file, 'w', encoding='utf-8') as f:
        f.write(batch_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Batch ID: {batch_id}")
    logger.info(f"Batch ID saved to: {batch_id_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_3_poll_batch.py")
    logger.info("")
    logger.info("Or check status manually:")
    logger.info(f"  curl https://api.openai.com/v1/batches/{batch_id} \\")
    logger.info(f"    -H 'Authorization: Bearer $OPENAI_API_KEY'")


if __name__ == "__main__":
    main()
