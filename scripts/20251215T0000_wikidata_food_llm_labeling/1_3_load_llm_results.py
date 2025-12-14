#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_load_llm_results.py

【目的】
OpenAI Batch API の結果 JSONL を BigQuery にロードする

【処理内容】
1. Batch API のレスポンス（results.jsonl）を読み込む
2. 各行の results 配列を展開
3. item_qid, label, confidence, reason を抽出
4. BigQuery の wikidata_food_llm_labels にロード

【使用方法】
python3 1_3_load_llm_results.py --run-id 20251215T0000_v1

【入力】
/tmp/wikidata_food_llm/results.jsonl
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict
from datetime import datetime

from loader_bigquery import BigQueryLoader
from llm_client import LLMClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
TASK_ID = "#548_menu_blacklist_classification"
MODEL_NAME = "gpt-4o-mini"  # #548 【仕様】gpt-4.1-mini は gpt-4o-mini として提供

# 入力ファイル
INPUT_DIR = Path("/tmp/wikidata_food_llm")
INPUT_FILE = INPUT_DIR / "results.jsonl"


def load_batch_results(filepath: Path) -> List[Dict]:
    """
    Batch API の結果を読み込む
    
    Args:
        filepath: results.jsonl のパス
        
    Returns:
        全ラベルのリスト
    """
    all_labels = []
    llm_client = LLMClient()
    
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                batch_response = json.loads(line)
                
                # Batch API のレスポンス構造を処理
                # #548 【設計】Batch API レスポンス形式
                if "response" in batch_response and "body" in batch_response["response"]:
                    response_body = batch_response["response"]["body"]
                    if "choices" in response_body and len(response_body["choices"]) > 0:
                        content = response_body["choices"][0]["message"]["content"]
                        
                        # LLM レスポンスをパース
                        labels = llm_client.parse_response(content)
                        all_labels.extend(labels)
                        logger.info(f"Processed line {line_num}: {len(labels)} labels")
                else:
                    logger.warning(f"Unexpected response format at line {line_num}")
            
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse line {line_num}: {e}")
                continue
            except Exception as e:
                logger.error(f"Error processing line {line_num}: {e}")
                continue
    
    logger.info(f"Total labels loaded: {len(all_labels)}")
    return all_labels


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load LLM results to BigQuery")
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251215T0000_v1)"
    )
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("Step 1-3: Loading LLM results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Run ID: {args.run_id}")
    
    # 入力ファイル確認
    if not INPUT_FILE.exists():
        logger.error(f"Input file not found: {INPUT_FILE}")
        logger.error("Please ensure Batch API results are downloaded to this location")
        sys.exit(1)
    
    # Batch API の結果を読み込む
    logger.info(f"Loading results from {INPUT_FILE}...")
    labels = load_batch_results(INPUT_FILE)
    
    if not labels:
        logger.warning("No labels to load")
        sys.exit(0)
    
    logger.info(f"Loaded {len(labels)} labels")
    
    # ラベルの統計を表示
    label_counts = {}
    confidence_counts = {}
    for label in labels:
        label_key = label.get("label", "unknown")
        conf_key = label.get("confidence", "unknown")
        label_counts[label_key] = label_counts.get(label_key, 0) + 1
        confidence_counts[conf_key] = confidence_counts.get(conf_key, 0) + 1
    
    logger.info("Label distribution:")
    for label_key, count in sorted(label_counts.items()):
        logger.info(f"  {label_key}: {count}")
    
    logger.info("Confidence distribution:")
    for conf_key, count in sorted(confidence_counts.items()):
        logger.info(f"  {conf_key}: {count}")
    
    # BigQuery にロード
    logger.info("Loading to BigQuery...")
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    bq_loader.load_llm_labels(
        labels=labels,
        task=TASK_ID,
        model=MODEL_NAME,
        run_id=args.run_id
    )
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_4_apply_llm_labels.py --run-id {args.run_id}")


if __name__ == "__main__":
    main()
