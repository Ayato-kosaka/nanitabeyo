#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_load_results.py

【目的】
Pass1 の結果を BigQuery wikidata_food_llm_labels テーブルにロード

【処理内容】
1. p1_results.jsonl を読み込み
2. レスポンスをパースして LLM 結果を抽出
3. wikidata_food_llm_labels 用の JSONL に変換
4. BigQuery にロード
5. メトリクスを集計・出力

【使用方法】
python3 1_4_load_results.py
python3 1_4_load_results.py --config config.yml
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from datetime import datetime

# #572 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl, ensure_directory
from lib.bq import BigQueryClient, get_wikidata_food_llm_labels_schema
from lib.metrics import MetricsCollector

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_batch_results(results_jsonl: list, model: str, task: str, run_id: str) -> tuple:
    """
    Batch API の結果をパースして LLM labels 形式に変換
    
    Args:
        results_jsonl: Batch API の結果リスト
        model: モデル名
        task: タスク識別子
        run_id: 実行ID
        
    Returns:
        (parsed_items, batch_responses) のタプル
    """
    parsed_items = []
    batch_responses = []
    created_at = datetime.utcnow().isoformat() + "Z"
    
    for line in results_jsonl:
        response_body = line.get("response", {}).get("body", {})
        batch_responses.append(line)
        
        # tool_calls から結果を抽出
        try:
            choices = response_body.get("choices", [])
            if not choices:
                logger.warning(f"No choices in response for {line.get('custom_id')}")
                continue
            
            message = choices[0].get("message", {})
            tool_calls = message.get("tool_calls", [])
            
            if not tool_calls:
                logger.warning(f"No tool_calls in response for {line.get('custom_id')}")
                continue
            
            function = tool_calls[0].get("function", {})
            arguments = json.loads(function.get("arguments", "{}"))
            results = arguments.get("results", [])
            
            for result in results:
                # #572 【設計】score と is_regional を reason に埋め込む
                # BigQuery の既存スキーマに合わせて label フィールドに score を格納
                reason_text = result.get("reason", "")
                is_regional = result.get("is_regional", False)
                regional_reason = result.get("regional_reason", "")
                
                # regional 情報を reason に付加
                if is_regional and regional_reason:
                    reason_text = f"{reason_text} | regional: {regional_reason}"
                
                parsed_items.append({
                    "item_qid": result.get("item_qid"),
                    "task": task,
                    "label": str(result.get("score")),  # score を文字列として保存
                    "confidence": result.get("confidence"),
                    "reason": reason_text,
                    "model": model,
                    "run_id": run_id,
                    "created_at": created_at
                })
        
        except Exception as e:
            logger.error(f"Failed to parse response for {line.get('custom_id')}: {e}")
            continue
    
    logger.info(f"Parsed {len(parsed_items)} items from {len(results_jsonl)} batches")
    return parsed_items, batch_responses


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load Pass1 results to BigQuery")
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
    logger.info("Step 1-4: Load Pass1 results to BigQuery")
    logger.info("=" * 80)
    
    # 入力ファイルパス
    results_dir = Path(config['results_dir'])
    results_file = results_dir / "p1_results.jsonl"
    
    if not results_file.exists():
        logger.error(f"Results file not found: {results_file}")
        logger.error("Please run 1_3_poll_batch.py first")
        return
    
    # 結果読み込み
    results_jsonl = read_jsonl(results_file)
    
    # 結果パース
    run_id = config['run_id_prefix'] + "_p1"
    parsed_items, batch_responses = parse_batch_results(
        results_jsonl,
        config['model_pass1'],
        config['task_pass1'],
        run_id
    )
    
    if not parsed_items:
        logger.error("No items to load")
        return
    
    # 一時 JSONL 作成
    temp_jsonl = results_dir / "p1_labels_for_bq.jsonl"
    with open(temp_jsonl, 'w', encoding='utf-8') as f:
        for item in parsed_items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    
    # BigQuery にロード
    bq_client = BigQueryClient()
    table_id = f"{config['dataset']}.wikidata_food_llm_labels"
    
    logger.info(f"Loading {len(parsed_items)} items to {table_id}...")
    schema = get_wikidata_food_llm_labels_schema()
    bq_client.load_from_jsonl(table_id, temp_jsonl, schema, "WRITE_APPEND")
    
    # メトリクス集計
    metrics_collector = MetricsCollector()
    metrics_collector.collect_pass1_metrics(parsed_items, batch_responses)
    
    # レポート保存
    metrics_file = results_dir / "p1_metrics.json"
    metrics_collector.save_report(metrics_file)
    
    # サマリー出力
    metrics_collector.print_summary()
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Loaded {len(parsed_items)} items to BigQuery")
    logger.info(f"Metrics saved to: {metrics_file}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 1_5_publish_features.py (after Pass2 is complete)")
    logger.info("  OR run Pass2 for medium/low confidence items:")
    logger.info("  python3 2_1_export_input.py")


if __name__ == "__main__":
    main()
