#!/usr/bin/env python3
"""#582 Pass2 Step 6: catalog投入"""
import sys, logging, yaml
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def main():
    logger.info("="*80 + "\nPass2 Step 2-6: Publishing to catalog\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    
    dataset = config["dataset"]
    run_id_p2 = config["run_id_prefix"] + "_p2"
    run_id_p2 = config["run_id_prefix"] + "_p2"
    adopt_conf = tuple(config["adopt_confidence"])
    
    sql_file = SCRIPT_DIR / "sql" / "publish_catalog.sql"
    with open(sql_file) as f: sql_template = f.read()
    
    bq_client = BigQueryClient("food-scroll", dataset.split('.')[1])
    
    affected = bq_client.publish_catalog(sql_template, {
        "dataset": dataset,
        "pass1_run_id": run_id_p2,
        "pass2_run_id": run_id_p2,
        "adopt_confidence": adopt_conf
    })
    
    logger.info("="*80 + f"\n✅ Published {affected} rows\n" + "="*80)
    logger.info("\nPass2 complete. For Pass2:\n  python3 2_1_export_input.py")

if __name__ == "__main__": main()
