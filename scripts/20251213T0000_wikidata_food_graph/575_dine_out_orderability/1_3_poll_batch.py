#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_poll_batch.py

【目的】
Batch API のジョブをポーリングして結果をダウンロード

【処理内容】
1. batch_id.txt からバッチIDを読み込む
2. 定期的にステータスをポーリング
3. 完了したら結果をダウンロード

【使用方法】
python3 1_3_poll_batch.py
python3 1_3_poll_batch.py --config config.yml
"""

import sys
import os
import logging
import argparse
from pathlib import Path

# #575 【設計】lib モジュールをインポート
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
    parser = argparse.ArgumentParser(description="Poll batch status and download results")
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
    logger.info("Step 1-3: Poll batch status and download results")
    logger.info("=" * 80)
    
    # OpenAI API キー取得
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.error("OPENAI_API_KEY environment variable not set")
        logger.error("Please set: export OPENAI_API_KEY='sk-...'")
        return
    
    # batch_id を読み込み
    results_dir = Path(config['results_dir'])
    batch_id_file = results_dir / "batch_id.txt"
    
    if not batch_id_file.exists():
        logger.error(f"Batch ID file not found: {batch_id_file}")
        logger.error("Please run: python3 1_3_submit_batch.py")
        return
    
    with open(batch_id_file, 'r', encoding='utf-8') as f:
        batch_id = f.read().strip()
    
    logger.info(f"Batch ID: {batch_id}")
    
    # Batch API クライアント初期化
    batch_client = BatchAPIClient(api_key)
    
    # ポーリング開始
    poll_interval = config.get('batch_poll_interval_sec', 30)
    logger.info(f"Polling interval: {poll_interval} seconds")
    
    status_data = batch_client.poll_until_complete(batch_id, poll_interval)
    
    # 結果ダウンロード
    output_file_id = status_data.get('output_file_id')
    if not output_file_id:
        logger.error("No output_file_id in batch response")
        return
    
    output_path = results_dir / "results.jsonl"
    count = batch_client.download_results(output_file_id, output_path)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Downloaded {count} results to {output_path}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_4_load_results.py")


if __name__ == "__main__":
    main()
