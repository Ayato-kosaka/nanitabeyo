#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_poll_batch.py

【目的】
Pass2 バッチのステータスをポーリングし、完了後に結果をダウンロード

【処理内容】
1. p2_batch_id.txt からバッチIDを読み込む
2. バッチステータスをポーリング
3. 完了後に結果ファイルをダウンロード（p2_results.jsonl）

【使用方法】
python3 1_3_poll_batch.py
python3 1_3_poll_batch.py --config config.yml
"""

import os
import sys
import logging
import argparse
from pathlib import Path

# #572 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config
from lib.batch_api import BatchAPIClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Poll Pass2 batch status and download results")
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
    logger.info("Step 2-3 (poll): Poll Pass2 batch status and download results")
    logger.info("=" * 80)
    
    # batch_id 読み込み
    results_dir = Path(config['results_dir'])
    batch_id_file = results_dir / "p2_batch_id.txt"
    
    if not batch_id_file.exists():
        logger.error(f"Batch ID file not found: {batch_id_file}")
        logger.error("Please run 1_3_submit_batch.py first")
        return
    
    with open(batch_id_file, 'r') as f:
        batch_id = f.read().strip()
    
    logger.info(f"Batch ID: {batch_id}")
    
    # Batch API クライアント初期化
    batch_client = BatchAPIClient(api_key)
    
    # ポーリング実行
    poll_interval = config.get('batch_poll_interval_sec', 30)
    logger.info(f"Polling batch status (interval={poll_interval}s)...")
    
    status_data = batch_client.poll_until_complete(batch_id, poll_interval)
    
    # 結果ダウンロード
    output_file_id = status_data.get('output_file_id')
    if not output_file_id:
        logger.error("No output_file_id in batch response")
        return
    
    output_path = results_dir / "p2_results.jsonl"
    count = batch_client.download_results(output_file_id, output_path)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-3 (poll) completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Downloaded {count} results to {output_path}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 2_4_load_results.py")


if __name__ == "__main__":
    main()
