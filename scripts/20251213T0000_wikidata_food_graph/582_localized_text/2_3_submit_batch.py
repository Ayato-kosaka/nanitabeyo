#!/usr/bin/env python3
"""#582 Pass2 Step 3: Batch投入"""
import sys, logging, yaml
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.batch_api import BatchAPIClient
from lib.io import write_text, ensure_dir

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def main():
    logger.info("="*80 + "\nPass2 Step 2-3: Submitting batch\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    payload_dir = Path(config["paths"]["payload_dir"])
    results_dir = Path(config["paths"]["results_dir"])
    ensure_dir(results_dir)
    
    payload_file = payload_dir / "batch_payload_p2.jsonl"
    batch_id_file = results_dir / "p2_batch_id.txt"
    
    client = BatchAPIClient()
    file_id = client.upload_file(str(payload_file))
    batch_id = client.create_batch(file_id)
    write_text(batch_id_file, batch_id)
    
    logger.info("="*80 + f"\n✅ Batch submitted: {batch_id}\n" + "="*80)
    logger.info(f"\nBatch ID saved to: {batch_id_file}\nNext: python3 1_4_poll_batch.py")

if __name__ == "__main__": main()
