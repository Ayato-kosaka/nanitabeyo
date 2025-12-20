#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_load_region_llm_results.py

【目的】
OpenAI Batch API の結果 JSONL を BigQuery にロードする

【処理内容】
1. Batch API のレスポンス（results.jsonl）を読み込む
2. 各行の results 配列を展開
3. item_qid, decision, confidence, reason を抽出
4. ロード前検証（件数・順序・enum・maxLength）
5. BigQuery の wikidata_food_llm_labels にロード

【使用方法】
python3 1_3_load_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --input results_global.jsonl
python3 1_3_load_region_llm_results.py --market country:JP --run-id 20251218T0100_jp_v1 --input results_jp.jsonl

【入力】
指定された --input ファイル
"""

import sys
import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

from loader_bigquery import BigQueryLoader

# #557 【設計】region gate 専用モジュールをインポート
from region_gate_schema import parse_response

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
MODEL_NAME = "gpt-5-mini"  # #557 【設計】pass1 model: gpt-5-mini

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_region_gate")

# market 定義
VALID_MARKETS = ["scope:global", "country:JP"]


def load_batch_results(filepath: Path) -> List[Dict]:
    """
    Batch API の結果を読み込む

    Args:
        filepath: results.jsonl のパス

    Returns:
        全ラベルのリスト
    """
    all_labels: List[Dict] = []
    failed_output_file = INPUT_DIR / f"failed_custom_ids_{filepath.stem}.jsonl"

    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue

            custom_id = f"line_{line_num}"

            try:
                batch_response = json.loads(line)
                custom_id = batch_response.get("custom_id", custom_id)

                # Batch API 正常レスポンスか確認
                if (
                    "response" not in batch_response
                    or "body" not in batch_response["response"]
                ):
                    raise ValueError("Missing response.body")

                response_body = batch_response["response"]["body"]

                # #557 【設計】parse_response を直接呼び出し
                validated, err = parse_response(
                    response_body,
                    expected_items=None  # results.jsonl 単体では照合不可
                )

                if err is not None or validated is None:
                    # LLM 出力はあるが構造的に失敗
                    with open(failed_output_file, 'a', encoding='utf-8') as fout:
                        fout.write(json.dumps({
                            "custom_id": custom_id,
                            "error_code": err.code if err else "unknown",
                            "error_message": err.message if err else "unknown error",
                            "original_line": line.strip(),
                        }, ensure_ascii=False) + "\n")
                    logger.warning(
                        f"Parse failed at line {line_num} "
                        f"(custom_id={custom_id}, code={err.code if err else 'unknown'})"
                    )
                    continue

                # 正常系
                all_labels.extend(validated)
                logger.info(
                    f"Processed line {line_num}: {len(validated)} labels"
                )

            except Exception as e:
                # JSON壊れ / 想定外例外
                logger.error(f"Failed to process line {line_num}: {e}")
                with open(failed_output_file, 'a', encoding='utf-8') as fout:
                    fout.write(json.dumps({
                        "custom_id": custom_id,
                        "error_code": "exception",
                        "error_message": str(e),
                        "original_line": line.strip(),
                    }, ensure_ascii=False) + "\n")
                continue

    logger.info(f"Total labels loaded: {len(all_labels)}")
    return all_labels


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Load region LLM results to BigQuery")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market for this batch (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="Input results file name (e.g., results_global.jsonl)"
    )
    args = parser.parse_args()
    
    market = args.market
    run_id = args.run_id
    input_filename = args.input
    
    logger.info("=" * 80)
    logger.info("Step 1-3: Loading region LLM results to BigQuery")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Model: {MODEL_NAME}")
    
    # task 命名
    if market == "scope:global":
        task_id = "#557_region_scope_global"
    elif market == "country:JP":
        task_id = "#557_region_country_JP"
    else:
        logger.error(f"Unknown market: {market}")
        sys.exit(1)
    
    logger.info(f"Task: {task_id}")
    
    # 入力ファイル決定
    input_file = INPUT_DIR / input_filename
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error("Please ensure Batch API results are downloaded to this location")
        sys.exit(1)
    
    # Batch API の結果を読み込む
    logger.info(f"Loading results from {input_file}...")
    labels = load_batch_results(input_file)
    
    if not labels:
        logger.warning("No labels to load")
        sys.exit(0)
    
    logger.info(f"Loaded {len(labels)} labels")
    
    # ラベルの統計を表示
    decision_counts = {}
    confidence_counts = {}
    for label in labels:
        decision_key = label.get("decision", "unknown")
        conf_key = label.get("confidence", "unknown")
        decision_counts[decision_key] = decision_counts.get(decision_key, 0) + 1
        confidence_counts[conf_key] = confidence_counts.get(conf_key, 0) + 1
    
    logger.info("Decision distribution:")
    for decision_key, count in sorted(decision_counts.items()):
        logger.info(f"  {decision_key}: {count}")
    
    logger.info("Confidence distribution:")
    for conf_key, count in sorted(confidence_counts.items()):
        logger.info(f"  {conf_key}: {count}")
    
    # BigQuery にロード
    logger.info("Loading to BigQuery...")
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    bq_loader.load_region_gate_llm_labels(
        labels=labels,
        task=task_id,
        model=MODEL_NAME,
        run_id=run_id
    )
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info(f"  python3 1_4_apply_region_llm_results.py --market {market} --run-id {run_id}")


if __name__ == "__main__":
    main()
