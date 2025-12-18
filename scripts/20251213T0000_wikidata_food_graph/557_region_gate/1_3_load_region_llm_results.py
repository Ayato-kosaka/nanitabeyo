#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_load_region_llm_results.py

【目的】
OpenAI Batch API の結果を wikidata_food_llm_labels テーブルにロードする

【処理内容】
1. Batch API のレスポンス JSONL を読み込む
2. ラベル統計を表示
3. wikidata_food_llm_labels テーブルにロード

【使用方法】
python3 1_3_load_region_llm_results.py --market scope:global --run_id 20251218T0000_global_v1 --input results_global.jsonl
python3 1_3_load_region_llm_results.py --market country:JP --run_id 20251218T0100_jp_v1 --input results_jp.jsonl

【注意】
- 同じ run_id で複数回実行すると重複データが登録されます
- 再実行する場合は新しい run_id を使用してください
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict
from collections import Counter

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

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
MODEL = "gpt-4o-mini"


def parse_batch_results(input_file: Path) -> List[Dict]:
    """
    Batch API の結果を解析する
    
    Args:
        input_file: results.jsonl のパス
        
    Returns:
        ラベルのリスト
    """
    logger.info(f"Parsing batch results from {input_file}...")
    
    labels = []
    error_count = 0
    
    with open(input_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                response = json.loads(line)
                
                # エラーレスポンスをスキップ
                if response.get("error"):
                    logger.warning(f"Line {line_num}: Error response: {response['error']}")
                    error_count += 1
                    continue
                
                # レスポンスから content を取得
                body = response.get("response", {}).get("body", {})
                choices = body.get("choices", [])
                
                if not choices:
                    logger.warning(f"Line {line_num}: No choices in response")
                    error_count += 1
                    continue
                
                content = choices[0].get("message", {}).get("content", "")
                
                if not content:
                    logger.warning(f"Line {line_num}: Empty content")
                    error_count += 1
                    continue
                
                # JSON をパース
                result = json.loads(content)
                
                # results 配列を取得
                if "results" not in result:
                    logger.warning(f"Line {line_num}: No 'results' key in response")
                    error_count += 1
                    continue
                
                # 各アイテムのラベルを追加
                for item in result["results"]:
                    labels.append({
                        "item_qid": item["item_qid"],
                        "decision": item["decision"],
                        "confidence": item["confidence"],
                        "reason": item.get("reason", "")
                    })
            
            except json.JSONDecodeError as e:
                logger.warning(f"Line {line_num}: JSON decode error: {e}")
                error_count += 1
                continue
            except Exception as e:
                logger.warning(f"Line {line_num}: Unexpected error: {e}")
                error_count += 1
                continue
    
    logger.info(f"Parsed {len(labels)} labels ({error_count} errors)")
    return labels


def print_statistics(labels: List[Dict]):
    """
    ラベル統計を表示する
    
    Args:
        labels: ラベルのリスト
    """
    logger.info("=" * 80)
    logger.info("Label Statistics")
    logger.info("=" * 80)
    
    # decision ごとの集計
    decision_counts = Counter([label["decision"] for label in labels])
    logger.info("Decision breakdown:")
    for decision, count in sorted(decision_counts.items()):
        percentage = count / len(labels) * 100 if labels else 0
        logger.info(f"  {decision}: {count} ({percentage:.1f}%)")
    
    # confidence ごとの集計
    confidence_counts = Counter([label["confidence"] for label in labels])
    logger.info("\nConfidence breakdown:")
    for confidence, count in sorted(confidence_counts.items()):
        percentage = count / len(labels) * 100 if labels else 0
        logger.info(f"  {confidence}: {count} ({percentage:.1f}%)")
    
    # decision x confidence のクロス集計
    logger.info("\nDecision x Confidence breakdown:")
    cross_counts = Counter([(label["decision"], label["confidence"]) for label in labels])
    for (decision, confidence), count in sorted(cross_counts.items()):
        percentage = count / len(labels) * 100 if labels else 0
        logger.info(f"  {decision} + {confidence}: {count} ({percentage:.1f}%)")
    
    logger.info("=" * 80)


def load_to_bigquery(
    bq_loader: BigQueryLoader,
    labels: List[Dict],
    market: str,
    run_id: str
):
    """
    wikidata_food_llm_labels テーブルにロード
    
    Args:
        bq_loader: BigQueryLoader インスタンス
        labels: ラベルのリスト
        market: 'scope:global' または 'country:JP'
        run_id: 実行識別子
    """
    if not labels:
        logger.warning("No labels to load")
        return
    
    # #557 【設計】task 命名規則
    if market == "country:JP":
        task = "#557_region_country_JP"
    else:
        task = "#557_region_scope_global"
    
    table_id = f"{bq_loader.dataset_ref}.wikidata_food_llm_labels"
    logger.info(f"Loading {len(labels)} labels to {table_id}")
    logger.info(f"Task: {task}, Run ID: {run_id}, Model: {MODEL}")
    
    # データをロード
    rows_to_insert = []
    for label in labels:
        rows_to_insert.append({
            "item_qid": label["item_qid"],
            "task": task,
            "label": label["decision"],  # allow / deny / uncertain
            "confidence": label["confidence"],  # high / medium / low
            "reason": label["reason"],
            "model": MODEL,
            "run_id": run_id,
            "created_at": "CURRENT_TIMESTAMP()"  # BigQuery の現在時刻を使用
        })
    
    # INSERT 文を構築（BigQuery パラメータ化クエリ使用）
    values = []
    for row in rows_to_insert:
        # #557 【セキュリティ】reason フィールドを適切にエスケープ
        reason_escaped = row['reason'].replace("\\", "\\\\").replace("'", "\\'") if row['reason'] else ""
        values.append(
            f"('{row['item_qid']}', '{row['task']}', '{row['label']}', "
            f"'{row['confidence']}', '{reason_escaped}', "
            f"'{row['model']}', '{row['run_id']}', CURRENT_TIMESTAMP())"
        )
    
    sql = f"""
    INSERT INTO `{table_id}`
    (item_qid, task, label, confidence, reason, model, run_id, created_at)
    VALUES
    {', '.join(values)}
    """
    
    affected = bq_loader.execute_dml(sql)
    logger.info(f"Successfully loaded {affected} labels")


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Load region LLM results to BigQuery"
    )
    parser.add_argument(
        "--market",
        required=True,
        choices=["scope:global", "country:JP"],
        help="Target market (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run_id",
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to results.jsonl from OpenAI Batch API"
    )
    
    args = parser.parse_args()
    market = args.market
    run_id = args.run_id
    input_file = Path(args.input)
    
    logger.info("=" * 80)
    logger.info("Step 1-3: Loading region LLM results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Input: {input_file}")
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        return
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # Batch 結果を解析
    labels = parse_batch_results(input_file)
    
    if not labels:
        logger.warning("No labels parsed")
        return
    
    # 統計を表示
    print_statistics(labels)
    
    # BigQuery にロード
    load_to_bigquery(bq_loader, labels, market, run_id)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_4_apply_region_llm_results.py --market {market} --run_id {run_id}")


if __name__ == "__main__":
    main()
