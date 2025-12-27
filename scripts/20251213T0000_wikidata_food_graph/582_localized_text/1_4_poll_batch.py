#!/usr/bin/env python3
"""#582 Pass1 Step 4: Batch完了待機＆ダウンロード"""
import sys, logging, yaml
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.batch_api import BatchAPIClient
from lib.io import read_text

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def main():
    logger.info("="*80 + "\nPass1 Step 1-4: Polling batch\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    results_dir = Path(config["paths"]["results_dir"])
    poll_interval = config.get("batch_poll_interval_sec", 30)
    
    batch_id_file = results_dir / "p1_batch_id.txt"
    results_file = results_dir / "p1_results.jsonl"
    
    batch_id = read_text(batch_id_file)
    logger.info(f"Polling batch: {batch_id}")
    
    client = BatchAPIClient()
    status = client.poll_batch(batch_id, interval_sec=poll_interval)
    
    if status["status"] != "completed":
        logger.error(f"Batch failed with status: {status['status']}")
        sys.exit(1)
    
    output_file_id = status["output_file_id"]
    client.download_results(output_file_id, str(results_file))
    
    logger.info("="*80 + f"\n✅ Results downloaded\n" + "="*80)
    logger.info(f"\nResults: {results_file}\nNext: python3 1_5_load_results.py")

if __name__ == "__main__": main()
