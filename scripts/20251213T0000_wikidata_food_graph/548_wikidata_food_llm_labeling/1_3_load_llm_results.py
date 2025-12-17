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

# #548 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

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
MODEL_NAME = "gpt-4.1-mini"

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
    all_labels: List[Dict] = []
    # #548 【設計】LLMClient を初期化（menu_blacklist タスク用）
    llm_client = LLMClient(task="menu_blacklist")
    failed_output_file = INPUT_DIR / "failed_custom_ids.jsonl"

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

                # parse_response は response_obj 全体を受け取る
                validated, err = llm_client.parse_response(
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
