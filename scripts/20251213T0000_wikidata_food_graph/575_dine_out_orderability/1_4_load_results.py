#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_load_results.py

【目的】
Batch API の結果をパースして BigQuery にロード

【処理内容】
1. results.jsonl を読み込んでパース
2. wikidata_food_llm_labels テーブルにロード
3. メトリクスを集計・出力

【使用方法】
python3 1_4_load_results.py
python3 1_4_load_results.py --config config.yml
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict
from google.cloud import bigquery

# #575 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl
from lib.bq import BigQueryClient, get_wikidata_food_llm_labels_schema
from lib.metrics import MetricsCollector

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_batch_results(batch_responses: List[Dict]) -> List[Dict]:
    """
    Batch API のレスポンスをパースして結果リストを生成
    
    Args:
        batch_responses: Batch API レスポンスのリスト
        
    Returns:
        パース済み結果のリスト
    """
    results = []
    
    for response in batch_responses:
        try:
            # レスポンスボディから tool_calls を取得
            body = response.get("response", {}).get("body", {})
            choices = body.get("choices", [])
            
            if not choices:
                logger.warning(f"No choices in response: {response.get('custom_id')}")
                continue
            
            message = choices[0].get("message", {})
            tool_calls = message.get("tool_calls", [])
            
            if not tool_calls:
                logger.warning(f"No tool_calls in response: {response.get('custom_id')}")
                continue
            
            # function arguments をパース
            function_args = tool_calls[0].get("function", {}).get("arguments", "{}")
            parsed_args = json.loads(function_args)
            
            # results 配列を取得
            batch_results = parsed_args.get("results", [])
            
            for item_result in batch_results:
                results.append({
                    "item_qid": item_result.get("item_qid"),
                    "score": item_result.get("score"),
                    "confidence": item_result.get("confidence"),
                    "reason": item_result.get("reason", "")
                })
        
        except Exception as e:
            logger.error(f"Failed to parse response: {response.get('custom_id')}")
            logger.error(f"Error: {e}")
            continue
    
    logger.info(f"Parsed {len(results)} items from batch responses")
    return results


def prepare_bq_rows(results: List[Dict], config: Dict) -> List[Dict]:
    """
    BigQuery ロード用の行データを準備
    
    Args:
        results: パース済み結果のリスト
        config: 設定辞書
        
    Returns:
        BigQuery 行データのリスト
    """
    run_id = config['run_id_prefix']
    task = config['task']
    model = config['model']
    
    rows = []
    for result in results:
        if result.get("score") is None:
            continue
        
        rows.append({
            "item_qid": result["item_qid"],
            "task": task,
            "label": str(result["score"]),
            "confidence": result["confidence"],
            "reason": result.get("reason", ""),
            "model": model,
            "run_id": run_id,
            "created_at": bigquery.ScalarQueryParameter(None, "TIMESTAMP", None).value
        })
    
    logger.info(f"Prepared {len(rows)} rows for BigQuery")
    return rows


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load batch results to BigQuery")
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
    logger.info("Step 1-4: Load batch results to BigQuery")
    logger.info("=" * 80)
    
    # 結果ファイルパス
    results_dir = Path(config['results_dir'])
    results_file = results_dir / "results.jsonl"
    
    if not results_file.exists():
        logger.error(f"Results file not found: {results_file}")
        logger.error("Please run: python3 1_3_poll_batch.py")
        return
    
    # 結果ファイル読み込み
    logger.info(f"Reading results from {results_file}...")
    batch_responses = read_jsonl(results_file)
    
    # 結果をパース
    logger.info("Parsing batch results...")
    results = parse_batch_results(batch_responses)
    
    if not results:
        logger.error("No results parsed from batch responses")
        return
    
    # メトリクス集計
    logger.info("Collecting metrics...")
    metrics_collector = MetricsCollector()
    metrics = metrics_collector.collect_metrics(results, batch_responses)
    
    # メトリクス表示
    metrics_collector.print_report()
    
    # メトリクスをファイルに保存
    metrics_file = results_dir / "metrics.json"
    metrics_collector.save_to_file(metrics_file)
    
    # BigQuery ロード用データ準備
    logger.info("Preparing data for BigQuery...")
    bq_rows = prepare_bq_rows(results, config)
    
    # BigQuery スキーマ定義
    schema = get_wikidata_food_llm_labels_schema()
    
    # BigQuery にロード
    logger.info("Loading data to BigQuery...")
    bq_client = BigQueryClient()
    table_id = f"{config['dataset']}.wikidata_food_llm_labels"
    
    load_count = bq_client.load_from_rows(
        table_id=table_id,
        rows=bq_rows,
        schema=schema,
        write_disposition="WRITE_APPEND"
    )
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Loaded {load_count} rows to {table_id}")
    logger.info(f"Metrics saved to {metrics_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_5_publish_features.py --dry-run")
    logger.info("  python3 1_5_publish_features.py")


if __name__ == "__main__":
    main()
