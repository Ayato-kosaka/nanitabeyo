#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_build_payload_phase2.py

【目的】
Phase1 結果から Phase2 レビュー用ペイロードを生成

【処理内容】
1. input.jsonl と Phase1 結果を BigQuery から読み込む
2. Phase1 スコアを付加したアイテムリストを作成
3. Phase2 review prompt でペイロードを生成
4. batch_payload_phase2.jsonl に出力

【使用方法】
python3 2_1_build_payload_phase2.py
python3 2_1_build_payload_phase2.py --config config.yml --force
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #581 【設計】lib/prompts モジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import load_yaml_config, read_jsonl, file_exists_or_skip, ensure_directory
from lib.bq import BigQueryClient
from prompts.jp_relevance_scoring_phase2 import (
    build_system_prompt,
    build_user_message,
    build_tool_spec
)

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def fetch_phase1_scores(bq_client: BigQueryClient, config: Dict) -> Dict[str, List[Dict]]:
    """
    Phase1 スコアを BigQuery から取得
    
    Args:
        bq_client: BigQueryClient
        config: 設定辞書
        
    Returns:
        item_qid → feature scores のマップ
    """
    run_id = f"{config['run_id_prefix']}_phase1"
    
    query = f"""
    SELECT
      item_qid,
      feature_type,
      feature_key,
      score,
      confidence,
      reason
    FROM `{config['dataset']}.wikidata_food_llm_feature_scores`
    WHERE task = '{config['task']}'
      AND run_id = '{run_id}'
      AND phase = 'phase1'
    ORDER BY item_qid, feature_type, feature_key
    """
    
    logger.info("Fetching Phase1 scores from BigQuery...")
    rows = bq_client.execute_query(query)
    
    # item_qid でグループ化
    scores_by_qid = {}
    for row in rows:
        qid = row['item_qid']
        if qid not in scores_by_qid:
            scores_by_qid[qid] = []
        
        scores_by_qid[qid].append({
            'feature_type': row['feature_type'],
            'feature_key': row['feature_key'],
            'score': row['score'],
            'confidence': row['confidence'],
            'reason': row['reason']
        })
    
    logger.info(f"Fetched Phase1 scores for {len(scores_by_qid)} items")
    return scores_by_qid


def create_batches(items_with_scores: List[Dict], batch_size: int) -> List[List[Dict]]:
    """
    アイテムをバッチに分割
    
    Args:
        items_with_scores: Phase1 スコア付きアイテムのリスト
        batch_size: バッチサイズ
        
    Returns:
        バッチのリスト
    """
    batches = []
    for i in range(0, len(items_with_scores), batch_size):
        batch = items_with_scores[i:i + batch_size]
        batches.append(batch)
    
    logger.info(f"Created {len(batches)} batches (size={batch_size})")
    return batches


def create_batch_request(items: List[Dict], custom_id: str, model: str) -> Dict:
    """
    Batch API 用のリクエストを生成
    
    Args:
        items: Phase1 スコア付きアイテムのリスト
        custom_id: カスタムID（リクエスト識別用）
        model: モデル名
        
    Returns:
        Batch API 用のリクエスト辞書
    """
    system_prompt = build_system_prompt()
    user_message = build_user_message(items)
    
    # 各アイテムの feature 数を取得（全アイテム同じはず）
    n_features_per_item = len(items[0]['phase1_scores']) if items else 0
    
    tool_spec = build_tool_spec(len(items), n_features_per_item)
    
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "tools": [tool_spec],
            "tool_choice": {"type": "function", "function": {"name": "submit_review_decisions"}},
            "temperature": 0.0
        }
    }


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Build Phase2 Batch API payload")
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
    logger.info("Step 2-1: Build Phase2 Batch API payload")
    logger.info("=" * 80)
    logger.info(f"Task: {config['task']}")
    logger.info(f"Model: {config['model']}")
    
    # 入力ファイル読み込み
    input_file = Path(config['input_export_path']) / "input.jsonl"
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error("Please run 1_1_export_input.py first")
        sys.exit(1)
    
    items = read_jsonl(input_file)
    logger.info(f"Loaded {len(items)} items from {input_file}")
    
    # Phase1 スコア取得
    bq_client = BigQueryClient()
    phase1_scores = fetch_phase1_scores(bq_client, config)
    
    # Phase1 スコアとマージ
    items_with_scores = []
    for item in items:
        qid = item['item_qid']
        if qid in phase1_scores:
            items_with_scores.append({
                'item_qid': qid,
                'label_ja': item.get('label_ja'),
                'desc_ja': item.get('desc_ja'),
                'aliases_top_ja': item.get('aliases_top_ja'),
                'phase1_scores': phase1_scores[qid]
            })
    
    logger.info(f"Merged {len(items_with_scores)} items with Phase1 scores")
    
    if not items_with_scores:
        logger.error("No items with Phase1 scores found")
        sys.exit(1)
    
    # 出力先ディレクトリ作成
    payload_dir = Path(config['payload_dir'])
    ensure_directory(payload_dir)
    
    # 出力ファイルパス
    output_file = payload_dir / "batch_payload_phase2.jsonl"
    
    # 既存ファイルチェック
    if file_exists_or_skip(output_file, args.force):
        logger.info("Skipping payload build (file already exists, use --force to overwrite)")
        return
    
    # バッチに分割
    batches = create_batches(items_with_scores, config['batch_size'])
    
    # ペイロード生成
    logger.info(f"Generating {len(batches)} batch requests...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for i, batch in enumerate(batches):
            custom_id = f"phase2_batch_{i:04d}"
            request = create_batch_request(batch, custom_id, config['model'])
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info("=" * 80)
    logger.info("✅ Step 2-1 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"Generated payload: {output_file}")
    logger.info(f"Total requests: {len(batches)}")
    logger.info("")
    logger.info("Next step:")
    logger.info("  python3 2_2_submit_batch_phase2.py")


if __name__ == "__main__":
    main()
