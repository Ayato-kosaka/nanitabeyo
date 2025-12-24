#!/usr/bin/env python3
"""#582 Pass1 Step 5: 結果をBigQueryロード"""
import sys, logging, yaml, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import read_jsonl, write_json
from lib.metrics import calculate_metrics, print_metrics

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def parse_results(results_jsonl: list, run_id: str, model: str):
    """Batch API結果をパース"""
    generations = []
    errors = []
    pass2_count = 0
    
    for line in results_jsonl:
        custom_id = line.get("custom_id", "")
        locale = custom_id.split("_")[1] if "_" in custom_id else "unknown"
        
        response = line.get("response", {})
        if response.get("status_code") != 200:
            errors.append({"custom_id": custom_id, "error": "non_200"})
            continue
        
        body = response.get("body", {})
        choices = body.get("choices", [])
        if not choices:
            errors.append({"custom_id": custom_id, "error": "no_choices"})
            continue
        
        content = choices[0].get("message", {}).get("content", [])
        if not content:
            errors.append({"custom_id": custom_id, "error": "no_content"})
            continue
        
        args_str = content.split("```json")[-1].split("```")[0].strip()
        try:
            args = json.loads(args_str)
            results_list = [args]
            
            for r in results_list:
                generations.append({
                    "item_qid": r["item_qid"],
                    "locale": locale,
                    "topic_title": r["topic_title"],
                    "tagline": r["tagline"],
                    "confidence": r.get("confidence", ""),
                    "model": model,
                    "run_id": run_id,
                    "note": "pass1"
                })
                
                if r["confidence"] in ["medium", "low"]:
                    pass2_count += 1
        except Exception as e:
            errors.append({"custom_id": custom_id, "error": str(e)})
    
    return generations, errors, pass2_count

def main():
    logger.info("="*80 + "\nPass1 Step 1-5: Loading results to BigQuery\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    
    dataset = config["dataset"]
    results_dir = Path(config["paths"]["results_dir"])
    run_id = config["run_id_prefix"] + "_p1"
    model = config["model_pass1"]
    
    results_file = results_dir / "p1_results.jsonl"
    metrics_file = results_dir / "p1_metrics.json"
    
    # 結果読み込み＆パース
    results_jsonl = read_jsonl(results_file)
    logger.info(f"Loaded {len(results_jsonl)} result lines")
    
    generations, errors, pass2_count = parse_results(results_jsonl, run_id, model)

    # エラーをログに出力
    for error in errors:
        logger.warning(f"Error for {error['custom_id']}: {error['error']}")
    
    logger.info(f"Parsed {len(generations)} generations, {len(errors)} errors")
    logger.info(f"Pass2 trigger count: {pass2_count}")
    
    # BigQueryロード
    bq_client = BigQueryClient("food-scroll", dataset.split('.')[1])
    bq_client.load_generations(generations)
    
    # メトリクス計算＆保存
    input_count = len(generations) + len(errors)
    metrics = calculate_metrics(input_count, generations, errors, pass2_count)
    write_json(metrics_file, metrics)
    print_metrics(metrics)
    
    logger.info("="*80 + "\n✅ Pass1 Step 1-5 completed\n" + "="*80)
    logger.info(f"\nMetrics: {metrics_file}\nNext: python3 1_6_publish_catalog.py")

if __name__ == "__main__": main()
