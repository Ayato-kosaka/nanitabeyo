#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_3_load_macro_genre_llm_results.py

【目的】
Batch 結果 JSONL を読み込み、BigQuery の wikidata_food_llm_labels にロードする

【処理内容】
1. Batch API の結果ファイル（JSONL）を読み込む
2. LLMClient を使用してレスポンスをパース
3. BigQuery の wikidata_food_llm_labels にロード
4. task='#550_macro_genre_abc_classification' で保存

【使用方法】
python3 2_3_load_macro_genre_llm_results.py --results-file <path> --run-id <run_id>

例:
python3 2_3_load_macro_genre_llm_results.py \
  --results-file /tmp/batch_results.jsonl \
  --run-id 20251217T0000_v1
"""

import sys
import json
import logging
import argparse
from pathlib import Path

# #550 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient
from loader_bigquery import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
TASK_NAME = "#550_macro_genre_abc_classification"
MODEL_NAME = "gpt-4.1-mini"


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load macro_genre LLM results to BigQuery")
    parser.add_argument(
        "--results-file",
        type=str,
        required=True,
        help="Path to batch results JSONL file"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251217T0000_v1)"
    )
    args = parser.parse_args()
    
    results_file = Path(args.results_file)
    
    logger.info("=" * 80)
    logger.info("Step 2-3: Loading macro_genre LLM results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Results file: {results_file}")
    logger.info(f"Run ID: {args.run_id}")
    logger.info(f"Task: {TASK_NAME}")
    
    # 結果ファイルの確認
    if not results_file.exists():
        logger.error(f"Results file not found: {results_file}")
        sys.exit(1)
    
    # #550 【設計】LLMClient を初期化（macro_genre タスク用）
    logger.info("Initializing LLM client for macro_genre task...")
    llm_client = LLMClient(task="macro_genre")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # 結果ファイルを読み込み、パースする
    logger.info("Reading and parsing batch results...")
    all_labels = []
    parse_errors = []
    
    with open(results_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                batch_result = json.loads(line)
                custom_id = batch_result.get("custom_id")
                response = batch_result.get("response")
                
                if not response:
                    logger.warning(f"Line {line_num}: No response found for {custom_id}")
                    continue
                
                # レスポンスボディをパース
                body = response.get("body")
                if not body:
                    logger.warning(f"Line {line_num}: No body in response for {custom_id}")
                    continue
                
                # #550 【設計】LLMClient でパース
                parsed_results, parse_error = llm_client.parse_response(body)
                
                if parse_error:
                    logger.error(f"Line {line_num} ({custom_id}): Parse error - {parse_error.code}: {parse_error.message}")
                    parse_errors.append({
                        "line": line_num,
                        "custom_id": custom_id,
                        "error": parse_error
                    })
                    continue
                
                all_labels.extend(parsed_results)
                
                if line_num % 100 == 0:
                    logger.info(f"Processed {line_num} batch results...")
            
            except json.JSONDecodeError as e:
                logger.error(f"Line {line_num}: JSON decode error - {e}")
                parse_errors.append({
                    "line": line_num,
                    "error": str(e)
                })
                continue
            except Exception as e:
                logger.error(f"Line {line_num}: Unexpected error - {e}")
                parse_errors.append({
                    "line": line_num,
                    "error": str(e)
                })
                continue
    
    logger.info(f"Parsed {len(all_labels)} labels from batch results")
    
    if parse_errors:
        logger.warning(f"Encountered {len(parse_errors)} parse errors")
        logger.warning("First 5 errors:")
        for err in parse_errors[:5]:
            logger.warning(f"  {err}")
    
    if not all_labels:
        logger.error("No labels to load")
        sys.exit(1)
    
    # #550 【設計】BigQuery にロード
    logger.info("Loading labels to BigQuery...")
    bq_loader.load_macro_genre_llm_labels(
        labels=all_labels,
        task=TASK_NAME,
        model=MODEL_NAME,
        run_id=args.run_id
    )
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Loaded {len(all_labels)} labels to BigQuery")
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 2_4_apply_macro_genre_llm_results.py --run-id {args.run_id}")


if __name__ == "__main__":
    main()
