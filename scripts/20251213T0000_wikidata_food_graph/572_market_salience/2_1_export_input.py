#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_export_input.py

【目的】
Pass2 入力データを BigQuery からエクスポート（Pass1 の medium/low confidence 対象）

【処理内容】
1. config.yml を読み込む
2. p2_export_input.sql を実行（Pass1 の medium/low を抽出）
3. 結果を JSONL ファイルにエクスポート

【使用方法】
python3 2_1_export_input.py
python3 2_1_export_input.py --config config.yml --force
"""

import sys
import logging
import argparse
from pathlib import Path

# #572 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import load_yaml_config, file_exists_or_skip, ensure_directory

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Export Pass2 input data from BigQuery")
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
    logger.info("Step 2-1: Export Pass2 input data from BigQuery")
    logger.info("=" * 80)
    logger.info(f"Dataset: {config['dataset']}")
    logger.info(f"Pass2 trigger confidence: {config['pass2_trigger_confidence']}")
    
    # 出力先ディレクトリ作成
    output_dir = Path(config['input_export_path'])
    ensure_directory(output_dir)
    
    # 出力ファイルパス
    output_file = output_dir / "p2_input.jsonl"
    
    # 既存ファイルチェック
    if file_exists_or_skip(output_file, args.force):
        logger.info("Skipping export (file already exists, use --force to overwrite)")
        return
    
    # SQL クエリ読み込み
    sql_file = Path(__file__).parent / "sql" / "p2_export_input.sql"
    with open(sql_file, 'r', encoding='utf-8') as f:
        query = f.read()
    
    # クエリパラメータ設定
    run_id_p1 = config['run_id_prefix'] + "_p1"
    params = {
        "DATASET": config['dataset'],
        "TASK_PASS1": config['task_pass1'],
        "RUN_ID_PASS1": run_id_p1,
        "PASS2_TRIGGER_CONFIDENCE": config['pass2_trigger_confidence']
    }
    
    # BigQuery クライアント初期化
    bq_client = BigQueryClient()
    
    # エクスポート実行
    logger.info(f"Exporting data to {output_file}...")
    count = bq_client.export_to_jsonl(query, output_file, params)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-1 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Exported {count} items to {output_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 2_2_build_payload.py")


if __name__ == "__main__":
    main()
