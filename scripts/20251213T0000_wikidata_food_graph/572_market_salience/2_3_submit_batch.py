#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_3_submit_batch.py

【目的】
Pass2 バッチを OpenAI Batch API に投入し、batch_id を保存

【処理内容】
1. batch_payload_p1.jsonl を OpenAI にアップロード
2. バッチジョブを作成
3. batch_id を保存（p2_batch_id.txt）

【使用方法】
python3 2_3_submit_batch.py
python3 2_3_submit_batch.py --config config.yml
"""

import os
import sys
import logging
import argparse
from pathlib import Path

# #572 【設計】lib モジュールをインポート
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
    parser = argparse.ArgumentParser(description="Submit Pass2 batch to OpenAI")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yml",
        help="Config file path (default: config.yml)"
    )
    args = parser.parse_args()
    
    # OpenAI API キー確認
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.error("OPENAI_API_KEY environment variable not set")
        return
    
    # 設定ファイル読み込み
    config_path = Path(__file__).parent / args.config
    config = load_yaml_config(config_path)
    
    logger.info("=" * 80)
    logger.info("Step 2-3: Submit Pass2 batch to OpenAI Batch API")
    logger.info("=" * 80)
    
    # ペイロードファイルパス
    payload_dir = Path(config['payload_dir'])
    payload_file = payload_dir / "batch_payload_p1.jsonl"
    
    if not payload_file.exists():
        logger.error(f"Payload file not found: {payload_file}")
        logger.error("Please run 2_2_build_payload.py first")
        return
    
    # Batch API クライアント初期化
    batch_client = BatchAPIClient(api_key)
    
    # メタデータ設定
    run_id = config['run_id_prefix'] + "_p1"
    metadata = {
        "task": config['task_pass2'],
        "run_id": run_id,
        "market": config['market_key']
    }
    
    # バッチ投入
    logger.info(f"Uploading and creating batch...")
    file_id = batch_client.upload_file(payload_file)
    batch_id = batch_client.create_batch(file_id, metadata)
    
    # batch_id を保存
    results_dir = Path(config['results_dir'])
    ensure_directory(results_dir)
    
    batch_id_file = results_dir / "p2_batch_id.txt"
    with open(batch_id_file, 'w') as f:
        f.write(batch_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Batch ID: {batch_id}")
    logger.info(f"Saved to: {batch_id_file}")
    logger.info("")
    logger.info("Next steps:")
    logger.info(f"  1. Wait for batch to complete (usually < 24h)")
    logger.info(f"  2. Check status: python3 2_3_poll_batch.py")
    logger.info(f"  3. Or check manually:")
    logger.info(f"     curl https://api.openai.com/v1/batches/{batch_id} \\")
    logger.info(f"       -H 'Authorization: Bearer $OPENAI_API_KEY'")


if __name__ == "__main__":
    main()
