#!/usr/bin/env python3
"""#582 Pass2 Step 2: ペイロード生成"""
import sys, logging, yaml
from pathlib import Path
from collections import defaultdict
sys.path.insert(0, str(Path(__file__).parent))
from lib.io import read_jsonl, write_jsonl, ensure_dir
from prompts import localized_text_ja, localized_text_en

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SCRIPT_DIR = Path(__file__).parent

def get_prompt_module(locale: str):
    return localized_text_ja if locale == "ja-JP" else localized_text_en

def create_batch_request(items: list, custom_id: str, locale: str, model: str) -> dict:
    prompt_module = get_prompt_module(locale)
    system_message = prompt_module.build_system_message()
    user_message = prompt_module.build_user_message(items)
    tool_spec = prompt_module.get_tool_spec(len(items))
    
    return {
        "custom_id": custom_id, "method": "POST", "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            "tools": [tool_spec],
            "tool_choice": {"type": "function", "function": {"name": "submit_localized_text"}},
            "temperature": 0.0
        }
    }

def main():
    logger.info("="*80 + "\nPass2 Step 2-2: Building payload\n" + "="*80)
    with open(SCRIPT_DIR/"config.yml") as f: config = yaml.safe_load(f)
    
    input_export_dir = Path(config["paths"]["input_export_dir"])
    payload_dir = Path(config["paths"]["payload_dir"])
    batch_size = config.get("batch_size", 10)
    model = config["model_pass2"]
    
    ensure_dir(payload_dir)
    input_file = input_export_dir / "p2_input.jsonl"
    output_file = payload_dir / "batch_payload_p2.jsonl"
    
    items = read_jsonl(input_file)
    if not items:
        logger.warning("No items to process")
        write_jsonl(output_file, [])
        return
    
    items_by_locale = defaultdict(list)
    for item in items: items_by_locale[item["locale"]].append(item)
    
    requests = []
    for locale, locale_items in items_by_locale.items():
        for i in range(0, len(locale_items), batch_size):
            batch = locale_items[i:i + batch_size]
            custom_id = f"p2_{locale}_{i // batch_size:05d}"
            requests.append(create_batch_request(batch, custom_id, locale, model))
    
    write_jsonl(output_file, requests)
    logger.info("="*80 + f"\n✅ Created {len(requests)} requests\n" + "="*80)
    logger.info(f"\nNext: python3 2_3_submit_batch.py")

if __name__ == "__main__": main()
