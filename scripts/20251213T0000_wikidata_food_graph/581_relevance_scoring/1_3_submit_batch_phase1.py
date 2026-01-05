#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_submit_batch_phase1.py

【目的】
Phase1 Batch API ペイロードを投入

【処理内容】
1. config.yml を読み込む
2. batch_payload_phase1.jsonl をアップロード
3. Batch API に投入
4. batch_id を保存

【使用方法】
python3 1_3_submit_batch_phase1.py
python3 1_3_submit_batch_phase1.py --config config.yml
"""

import sys
import os
import logging
import argparse
from pathlib import Path
from datetime import datetime

# #581 【設計】lib モジュールをインポート
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
    parser = argparse.ArgumentParser(description="Submit Phase1 Batch API payload")
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
    logger.info("Step 1-3: Submit Phase1 Batch API payload")
    logger.info("=" * 80)
    logger.info(f"Task: {config['task']}")
    logger.info(f"Model: {config['model']}")
    
    # OpenAI API キー確認
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.error("OPENAI_API_KEY environment variable is not set")
        logger.error("Please set it: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)
    
    # ペイロードファイル確認
    payload_file = Path(config['payload_dir']) / "batch_payload_phase1.jsonl"
    if not payload_file.exists():
        logger.error(f"Payload file not found: {payload_file}")
        logger.error("Please run 1_2_build_payload_phase1.py first")
        sys.exit(1)
    
    # 結果ディレクトリ作成
    results_dir = Path(config['results_dir'])
    ensure_directory(results_dir)
    
    # run_id 生成
    run_id = f"{config['run_id_prefix']}_phase1"
    logger.info(f"Run ID: {run_id}")
    
    # BatchAPIClient 初期化
    batch_client = BatchAPIClient(api_key)
    
    # ファイルアップロード
    logger.info(f"Uploading payload: {payload_file}")
    file_id = batch_client.upload_file(payload_file)
    
    # バッチ作成
    logger.info("Creating batch job...")
    metadata = {
        "task": config['task'],
        "run_id": run_id,
        "phase": "phase1"
    }
    batch_id = batch_client.create_batch(file_id, metadata)
    
    # batch_id を保存
    batch_id_file = results_dir / "batch_id_phase1.txt"
    with open(batch_id_file, 'w', encoding='utf-8') as f:
        f.write(batch_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Batch ID: {batch_id}")
    logger.info(f"Batch ID saved to: {batch_id_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_3_poll_batch_phase1.py")
    logger.info("")
    logger.info("Note: Batch processing may take several hours.")
    logger.info("You can check status by running the poll script.")


if __name__ == "__main__":
    main()
