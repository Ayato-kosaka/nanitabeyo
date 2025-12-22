#!/usr/bin/env python3
"""#581 Pass2 Step 1: Pass1のmedium/low抽出"""
import sys, logging, json, yaml
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import write_jsonl, ensure_dir

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def parse_aliases_json(aliases_json_str: str, max_aliases: int = 5) -> list:
    if not aliases_json_str: return []
    try:
        aliases_dict = json.loads(aliases_json_str)
        all_aliases = []
        for lang_aliases in aliases_dict.values():
            if isinstance(lang_aliases, list): all_aliases.extend(lang_aliases)
        return all_aliases[:max_aliases]
    except: return []

def main():
    logger.info("="*80 + "\nPass2 Step 2-1: Exporting Pass1 medium/low items\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    
    dataset = config["dataset"]
    pass1_run_id = config["run_id_prefix"] + "_p1"
    trigger_conf = tuple(config["pass2_trigger_confidence"])
    max_desc_chars = config.get("max_desc_chars", 200)
    max_aliases = config.get("max_aliases", 5)
    input_export_dir = Path(config["paths"]["input_export_dir"])
    
    ensure_dir(input_export_dir)
    output_file = input_export_dir / "p2_input.jsonl"
    
    sql_file = SCRIPT_DIR / "sql" / "p2_export_input.sql"
    with open(sql_file) as f: sql_template = f.read()
    
    bq_client = BigQueryClient("food-scroll", dataset.split('.')[1])
    items = bq_client.export_input(sql_template, {
        "dataset": dataset,
        "pass1_run_id": pass1_run_id,
        "trigger_confidence": trigger_conf
    })
    
    if not items:
        logger.warning("No items to retry (all Pass1 were high confidence)")
        write_jsonl(output_file, [])
        return
    
    logger.info(f"Found {len(items)} items to retry")
    
    formatted_items = []
    for item in items:
        desc = item.get("description", "") or ""
        if desc and len(desc) > max_desc_chars: desc = desc[:max_desc_chars]
        aliases_top = parse_aliases_json(item.get("aliases_json", ""), max_aliases)
        
        formatted_items.append({
            "item_qid": item["item_qid"],
            "locale": item["locale"],
            "label": item.get("label", ""),
            "description": desc,
            "aliases_top": aliases_top
        })
    
    write_jsonl(output_file, formatted_items)
    logger.info("="*80 + "\n✅ Pass2 Step 2-1 completed\n" + "="*80)
    logger.info(f"\nOutput: {output_file}\nNext: python3 2_2_build_payload.py")

if __name__ == "__main__": main()
