#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_2_poll_batch_phase2.py

【目的】
Phase2 Batch API の完了をポーリング

【処理内容】
1. config.yml を読み込む
2. batch_id_phase2.txt から batch_id を読み込む
3. バッチが完了するまでポーリング
4. 完了後、結果をダウンロード

【使用方法】
python3 2_2_poll_batch_phase2.py
python3 2_2_poll_batch_phase2.py --config config.yml
"""

import sys
import os
import logging
import argparse
from pathlib import Path

# #581 【設計】lib モジュールをインポート
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
    parser = argparse.ArgumentParser(description="Poll Phase2 Batch API completion")
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
    logger.info("Step 2-2: Poll Phase2 Batch API completion")
    logger.info("=" * 80)
    
    # OpenAI API キー確認
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.error("OPENAI_API_KEY environment variable is not set")
        logger.error("Please set it: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)
    
    # batch_id 読み込み
    results_dir = Path(config['results_dir'])
    batch_id_file = results_dir / "batch_id_phase2.txt"
    
    if not batch_id_file.exists():
        logger.error(f"Batch ID file not found: {batch_id_file}")
        logger.error("Please run 2_2_submit_batch_phase2.py first")
        sys.exit(1)
    
    with open(batch_id_file, 'r', encoding='utf-8') as f:
        batch_id = f.read().strip()
    
    logger.info(f"Batch ID: {batch_id}")
    
    # BatchAPIClient 初期化
    batch_client = BatchAPIClient(api_key)
    
    # ポーリング開始
    logger.info(f"Polling interval: {config['batch_poll_interval_sec']} seconds")
    logger.info("This may take several hours. Press Ctrl+C to stop polling.")
    logger.info("")
    
    try:
        status_data = batch_client.poll_until_complete(
            batch_id,
            poll_interval_sec=config['batch_poll_interval_sec']
        )
    except KeyboardInterrupt:
        logger.info("")
        logger.info("Polling interrupted by user")
        logger.info("You can resume polling by running this script again")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Polling failed: {e}")
        sys.exit(1)
    
    # 結果ダウンロード
    output_file_id = status_data.get('output_file_id')
    if not output_file_id:
        logger.error("No output file ID in batch status")
        logger.error(f"Status data: {status_data}")
        sys.exit(1)
    
    output_file = results_dir / "results_phase2.jsonl"
    logger.info(f"Downloading results to {output_file}...")
    count = batch_client.download_results(output_file_id, output_file)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-2 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Results downloaded: {output_file}")
    logger.info(f"Total responses: {count}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 2_3_load_results_phase2.py")


if __name__ == "__main__":
    main()
