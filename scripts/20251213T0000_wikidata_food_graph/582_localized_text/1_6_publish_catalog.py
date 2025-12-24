#!/usr/bin/env python3
"""#582 Pass1 Step 6: catalog投入"""
import sys, logging, yaml
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def main():
    logger.info("="*80 + "\nPass1 Step 1-6: Publishing to catalog\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    
    dataset = config["dataset"]
    run_id_p1 = config["run_id_prefix"] + "_p1"
    run_id_p2 = config["run_id_prefix"] + "_p2"
    adopt_conf_list = config["adopt_confidence"]
    if not adopt_conf_list:
        raise ValueError("config adopt_confidence is empty")

    adopt_conf_sql = "(" + ", ".join([f"'{c}'" for c in adopt_conf_list]) + ")"
    
    sql_file = SCRIPT_DIR / "sql" / "publish_catalog.sql"
    with open(sql_file) as f: sql_template = f.read()
    
    bq_client = BigQueryClient("food-scroll", dataset.split('.')[1])
    
    affected = bq_client.publish_catalog(sql_template, {
        "dataset": dataset,
        "pass1_run_id": run_id_p1,
        "pass2_run_id": run_id_p2,
        "adopt_confidence": adopt_conf_sql
    })
    
    logger.info("="*80 + f"\n✅ Published {affected} rows\n" + "="*80)
    logger.info("\nPass1 complete. For Pass2:\n  python3 2_1_export_input.py")

if __name__ == "__main__": main()
