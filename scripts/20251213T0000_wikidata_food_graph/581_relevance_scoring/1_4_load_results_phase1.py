#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_load_results_phase1.py

【目的】
Phase1 Batch API 結果を BigQuery にロード

【処理内容】
1. results_phase1.jsonl を読み込む
2. レスポンスをパースして feature scores を抽出
3. wikidata_food_llm_feature_scores テーブルにロード
4. メトリクスを集計・出力

【使用方法】
python3 1_4_load_results_phase1.py
python3 1_4_load_results_phase1.py --config config.yml
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

# #581 【設計】lib モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl
from lib.bq import BigQueryClient, get_wikidata_food_llm_feature_scores_schema
from lib.metrics import MetricsCollector

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_batch_response(response: Dict) -> List[Dict]:
    """
    Batch API レスポンスをパースして feature scores を抽出
    
    Args:
        response: Batch API レスポンス
        
    Returns:
        feature score のリスト
    """
    try:
        body = response.get('response', {}).get('body', {})
        choices = body.get('choices', [])
        
        if not choices:
            logger.warning(f"No choices in response for custom_id={response.get('custom_id')}")
            return []
        
        message = choices[0].get('message', {})
        tool_calls = message.get('tool_calls', [])
        
        if not tool_calls:
            logger.warning(f"No tool calls in response for custom_id={response.get('custom_id')}")
            return []
        
        function_args = tool_calls[0].get('function', {}).get('arguments', '{}')
        parsed_args = json.loads(function_args)
        
        results = parsed_args.get('results', [])
        
        # 各アイテムの features を展開
        feature_scores = []
        for item_result in results:
            item_qid = item_result.get('item_qid')
            features = item_result.get('features', [])
            
            for feature in features:
                feature_scores.append({
                    'item_qid': item_qid,
                    'feature_type': feature.get('feature_type'),
                    'feature_key': feature.get('feature_key'),
                    'score': feature.get('score'),
                    'confidence': feature.get('confidence'),
                    'reason': feature.get('reason', '')[:120]  # 120文字制限
                })
        
        return feature_scores
        
    except Exception as e:
        logger.error(f"Failed to parse response at custom_id={response.get('custom_id')}: {e}")
        logger.debug(f"Response: {response}")
        return []


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load Phase1 results to BigQuery")
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
    logger.info("Step 1-4: Load Phase1 results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Dataset: {config['dataset']}")
    logger.info(f"Task: {config['task']}")
    
    # 結果ファイル読み込み
    results_file = Path(config['results_dir']) / "results_phase1.jsonl"
    if not results_file.exists():
        logger.error(f"Results file not found: {results_file}")
        logger.error("Please run 1_3_poll_batch_phase1.py first")
        sys.exit(1)
    
    responses = read_jsonl(results_file)
    logger.info(f"Loaded {len(responses)} responses from {results_file}")
    
    # レスポンスをパース
    logger.info("Parsing responses...")
    all_feature_scores = []
    success_count = 0
    error_count = 0
    
    for response in responses:
        feature_scores = parse_batch_response(response)
        if feature_scores:
            all_feature_scores.extend(feature_scores)
            success_count += 1
        else:
            error_count += 1
    
    logger.info(f"Parsed {len(all_feature_scores)} feature scores")
    logger.info(f"Success: {success_count}, Errors: {error_count}")
    
    if not all_feature_scores:
        logger.error("No feature scores parsed from results")
        sys.exit(1)
    
    # run_id 生成
    run_id = f"{config['run_id_prefix']}_phase1"
    
    # BigQuery ロード用データ準備
    logger.info("Preparing data for BigQuery...")
    created_at = datetime.utcnow().isoformat()
    
    bq_rows = []
    for score in all_feature_scores:
        bq_rows.append({
            'item_qid': score['item_qid'],
            'feature_type': score['feature_type'],
            'feature_key': score['feature_key'],
            'score': score['score'],
            'confidence': score['confidence'],
            'reason': score['reason'],
            'phase': 'phase1',
            'task': config['task'],
            'model': config['model'],
            'run_id': run_id,
            'created_at': created_at
        })
    
    # BigQuery にロード
    logger.info(f"Loading {len(bq_rows)} rows to BigQuery...")
    bq_client = BigQueryClient()
    
    table_id = f"{config['dataset']}.wikidata_food_llm_feature_scores"
    bq_client.load_from_rows(table_id, bq_rows, get_wikidata_food_llm_feature_scores_schema())
    
    logger.info(f"Loaded {len(bq_rows)} rows to {table_id}")
    
    # メトリクス集計
    logger.info("Collecting metrics...")
    metrics_collector = MetricsCollector()
    
    metrics = {
        'input_count': len(responses),
        'success_count': success_count,
        'error_count': error_count,
        'feature_scores_count': len(all_feature_scores),
        'feature_type_distribution': {},
        'score_distribution': {'0': 0, '0.5': 0, '1': 0},
        'confidence_distribution': {}
    }
    
    for score in all_feature_scores:
        # feature_type 分布
        ft = score['feature_type']
        metrics['feature_type_distribution'][ft] = metrics['feature_type_distribution'].get(ft, 0) + 1
        
        # score 分布
        s = str(score['score'])
        metrics['score_distribution'][s] = metrics['score_distribution'].get(s, 0) + 1
        
        # confidence 分布
        c = score['confidence']
        metrics['confidence_distribution'][c] = metrics['confidence_distribution'].get(c, 0) + 1
    
    # メトリクス出力
    metrics_file = Path(config['results_dir']) / "metrics_phase1.json"
    with open(metrics_file, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Loaded {len(bq_rows)} feature scores to BigQuery")
    logger.info(f"Metrics saved to: {metrics_file}")
    logger.info("")
    logger.info("Metrics summary:")
    logger.info(f"  Input responses: {metrics['input_count']}")
    logger.info(f"  Success: {metrics['success_count']}")
    logger.info(f"  Errors: {metrics['error_count']}")
    logger.info(f"  Total feature scores: {metrics['feature_scores_count']}")
    logger.info("")
    logger.info("Feature type distribution:")
    for ft, count in metrics['feature_type_distribution'].items():
        logger.info(f"  {ft}: {count}")
    logger.info("")
    logger.info("Score distribution:")
    for s, count in metrics['score_distribution'].items():
        logger.info(f"  {s}: {count}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  Review Phase1 results in BigQuery")
    logger.info("  If satisfied, proceed with Phase2 review:")
    logger.info("  python3 2_1_build_payload_phase2.py")


if __name__ == "__main__":
    main()
