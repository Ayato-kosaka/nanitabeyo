#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_3_load_results_phase2.py

【目的】
Phase2 Batch API 結果（レビュー結果）を BigQuery にロード

【処理内容】
1. results_phase2.jsonl を読み込む
2. レビュー結果をパースして feature scores を抽出
   - accept: Phase1 スコアをそのまま使用（記録しない）
   - edit: 新しいスコアを Phase2 として記録
   - deny: 記録しない（confidence='deny'で記録し、後でフィルタ）
3. wikidata_food_llm_feature_scores テーブルにロード
4. メトリクスを集計・出力

【使用方法】
python3 2_3_load_results_phase2.py
python3 2_3_load_results_phase2.py --config config.yml
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
from lib.bq import BigQueryClient

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_batch_response(response: Dict, phase1_response: Dict) -> Dict[str, Any]:
    """
    Batch API レスポンスをパースしてレビュー結果を抽出
    
    Args:
        response: Batch API レスポンス
        
    Returns:
        レビュー結果の辞書
    """
    try:
        body = response.get('response', {}).get('body', {})
        choices = body.get('choices', [])

        
        if not choices:
            logger.warning(f"No choices in response for custom_id={response.get('custom_id')}")
            return {'accept': 0, 'edit': 0, 'deny': 0, 'scores': []}
        
        message = choices[0].get('message', {})
        tool_calls = message.get('tool_calls', [])
        
        if not tool_calls:
            logger.warning(f"No tool calls in response for custom_id={response.get('custom_id')}")
            return {'accept': 0, 'edit': 0, 'deny': 0, 'scores': []}
        
        function_args = tool_calls[0].get('function', {}).get('arguments', '{}')
        parsed_args = json.loads(function_args)
        
        results = parsed_args.get('results', [])

        phase1_body = phase1_response.get('response', {}).get('body', {})
        phase1_choices = phase1_body.get('choices', [])
        phase1_message = phase1_choices[0].get('message', {}) if phase1_choices else {}
        phase1_tool_calls = phase1_message.get('tool_calls', []) if phase1_message else []
        phase1_function_args = phase1_tool_calls[0].get('function', {}).get('arguments', '{}') if phase1_tool_calls else '{}'
        phase1_parsed_args = json.loads(phase1_function_args)
        phase1_results = phase1_parsed_args.get('results', []) if phase1_parsed_args else []
        
        # 各アイテムのレビューを処理
        accept_count = 0
        edit_count = 0
        deny_count = 0
        feature_scores = []
        
        for item_result in results:
            item_qid = item_result.get('item_qid')
            reviews = item_result.get('reviews', [])
            
            for review in reviews:
                action = review.get('action')
                feature_type = review.get('feature_type')
                feature_key = review.get('feature_key')
                
                if action == 'accept':
                    accept_count += 1
                    # typeof phase1_results
                    phase1_score = next((res for res in phase1_results
                                         if res.get('item_qid') == item_qid
                                            and any(f.get('feature_type') == feature_type and f.get('feature_key') == feature_key
                                                    for f in res.get('features', []))), None)
                    if not phase1_score:
                        logger.warning(f"Phase1 score not found for {item_qid} {feature_type} {feature_key}")
                        continue
                    # accept の場合は Phase1 スコアをそのまま使用
                    feature_scores.append({
                        'item_qid': item_qid,
                        'feature_type': feature_type,
                        'feature_key': feature_key,
                        'score': phase1_score.get('score'),
                        'confidence': review.get('new_confidence', ''),
                        'reason': review.get('new_reason', '')[:120]
                    })
                
                elif action == 'edit':
                    edit_count += 1
                    # edit の場合は新しいスコアを Phase2 として記録
                    feature_scores.append({
                        'item_qid': item_qid,
                        'feature_type': feature_type,
                        'feature_key': feature_key,
                        'score': review.get('new_score'),
                        'confidence': review.get('new_confidence'),
                        'reason': review.get('new_reason', '')[:120]
                    })
                
                elif action == 'deny':
                    deny_count += 1
                    # deny の場合は confidence='deny' で記録（publish 時にフィルタ）
                    feature_scores.append({
                        'item_qid': item_qid,
                        'feature_type': feature_type,
                        'feature_key': feature_key,
                        'score': 0.0,  # dummy
                        'confidence': 'deny',
                        'reason': review.get('new_reason', 'denied')[:120]
                    })
        
        return {
            'accept': accept_count,
            'edit': edit_count,
            'deny': deny_count,
            'scores': feature_scores
        }
        
    except Exception as e:
        logger.error(f"Failed to parse response: {e}")
        logger.debug(f"Response: {response}")
        return {'accept': 0, 'edit': 0, 'deny': 0, 'scores': []}


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load Phase2 results to BigQuery")
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
    logger.info("Step 2-3: Load Phase2 results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Dataset: {config['dataset']}")
    logger.info(f"Task: {config['task']}")
    
    # 結果ファイル読み込み
    results_file = Path(config['results_dir']) / "results_phase2.jsonl"
    if not results_file.exists():
        logger.error(f"Results file not found: {results_file}")
        logger.error("Please run 2_2_poll_batch_phase2.py first")
        sys.exit(1)
    
    # Phase 1 の結果を読み込み
    phase1_results_file = Path(config['results_dir']) / "results_phase1.jsonl"
    if not phase1_results_file.exists():
        logger.error(f"Phase1 results file not found: {phase1_results_file}")
        logger.error("Please run 1_3_load_results_phase1.py first")
        sys.exit(1)
    
    responses = read_jsonl(results_file)
    phase1_responses = read_jsonl(phase1_results_file)
    logger.info(f"Loaded {len(responses)} responses from {results_file}")
    logger.info(f"Loaded {len(phase1_responses)} Phase1 responses from {phase1_results_file}")
    
    # レスポンスをパース
    logger.info("Parsing responses...")
    all_feature_scores = []
    total_accept = 0
    total_edit = 0
    total_deny = 0
    success_count = 0
    error_count = 0
    
    for i, response in enumerate(responses):
        result = parse_batch_response(response, phase1_responses[i])
        if result['accept'] > 0 or result['edit'] > 0 or result['deny'] > 0:
            all_feature_scores.extend(result['scores'])
            total_accept += result['accept']
            total_edit += result['edit']
            total_deny += result['deny']
            success_count += 1
        else:
            error_count += 1
    
    logger.info(f"Parsed {len(all_feature_scores)} feature scores")
    logger.info(f"Review actions: accept={total_accept}, edit={total_edit}, deny={total_deny}")
    logger.info(f"Success: {success_count}, Errors: {error_count}")
    
    if not all_feature_scores:
        logger.warning("No feature scores to load (all were accepted)")
        logger.info("This is fine - Phase1 scores will be used")
        logger.info("Skipping BigQuery load")
        return
    
    # run_id 生成
    run_id = f"{config['run_id_prefix']}_phase2"
    
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
            'phase': 'phase2',
            'task': config['task'],
            'model': config['model'],
            'run_id': run_id,
            'created_at': created_at
        })
    
    # BigQuery にロード
    logger.info(f"Loading {len(bq_rows)} rows to BigQuery...")
    bq_client = BigQueryClient()
    
    table_id = f"{config['dataset']}.wikidata_food_llm_feature_scores"
    bq_client.load_rows(table_id, bq_rows)
    
    logger.info(f"Loaded {len(bq_rows)} rows to {table_id}")
    
    # メトリクス集計
    logger.info("Collecting metrics...")
    
    metrics = {
        'input_count': len(responses),
        'success_count': success_count,
        'error_count': error_count,
        'total_accept': total_accept,
        'total_edit': total_edit,
        'total_deny': total_deny,
        'feature_scores_count': len(all_feature_scores)
    }
    
    # メトリクス出力
    metrics_file = Path(config['results_dir']) / "metrics_phase2.json"
    with open(metrics_file, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-3 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Loaded {len(bq_rows)} feature scores to BigQuery")
    logger.info(f"Metrics saved to: {metrics_file}")
    logger.info("")
    logger.info("Metrics summary:")
    logger.info(f"  Input responses: {metrics['input_count']}")
    logger.info(f"  Success: {metrics['success_count']}")
    logger.info(f"  Errors: {metrics['error_count']}")
    logger.info(f"  Accept: {metrics['total_accept']}")
    logger.info(f"  Edit: {metrics['total_edit']}")
    logger.info(f"  Deny: {metrics['total_deny']}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 3_1_publish_features.py")


if __name__ == "__main__":
    main()
