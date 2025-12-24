#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】Pass1: Step 2 - Batch API ペイロード生成

p1_input.jsonl を読み込み、locale ごとに適切なプロンプトでペイロードを生成
"""

import sys
import json
import logging
from pathlib import Path
import yaml
from collections import defaultdict

# #582 【設計】親ディレクトリを sys.path に追加
sys.path.insert(0, str(Path(__file__).parent))

from lib.io import read_jsonl, write_jsonl, ensure_dir
from prompts import localized_text_ja, localized_text_en

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR / "config.yml"


def load_config():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def get_prompt_module(locale: str):
    """locale に応じた prompt module を取得"""
    if locale == "ja-JP":
        return localized_text_ja
    elif locale == "en":
        return localized_text_en
    else:
        raise ValueError(f"Unsupported locale: {locale}")


def create_batch_request(items: list, custom_id: str, locale: str, model: str) -> dict:
    """Batch API リクエストを生成"""
    prompt_module = get_prompt_module(locale)
    
    system_message = prompt_module.build_system_message()
    user_message = prompt_module.build_user_message(items)
    tool_spec = prompt_module.get_tool_spec(len(items))
    
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            # 検討の結果、tools を使うとそれに合わせようと精度が下がるため廃止
            # "tools": [tool_spec],
            # "tool_choice": {"type": "function", "function": {"name": "submit_localized_text"}},
            "temperature": 0.7
        }
    }


def main():
    logger.info("=" * 80)
    logger.info("Pass1 Step 1-2: Building Batch API payload")
    logger.info("=" * 80)
    
    config = load_config()
    input_export_dir = Path(config["paths"]["input_export_dir"])
    payload_dir = Path(config["paths"]["payload_dir"])
    batch_size = config.get("batch_size", 10)
    model = config["model_pass1"]
    
    ensure_dir(payload_dir)
    
    input_file = input_export_dir / "p1_input.jsonl"
    output_file = payload_dir / "batch_payload_p1.jsonl"
    
    logger.info(f"Input: {input_file}")
    logger.info(f"Output: {output_file}")
    logger.info(f"Batch size: {batch_size}")
    logger.info(f"Model: {model}")
    
    # データ読み込み
    items = read_jsonl(input_file)
    logger.info(f"Loaded {len(items)} items")
    
    # #582 【設計】locale ごとにグループ化
    items_by_locale = defaultdict(list)
    for item in items:
        items_by_locale[item["locale"]].append(item)
    
    # #582 【設計】locale ごとにバッチ生成
    requests = []
    for locale, locale_items in items_by_locale.items():
        logger.info(f"Processing {len(locale_items)} items for locale={locale}")
        
        for i in range(0, len(locale_items), batch_size):
            batch = locale_items[i:i + batch_size]
            custom_id = f"p1_{locale}_{i // batch_size:05d}"
            request = create_batch_request(batch, custom_id, locale, model)
            requests.append(request)
    
    # ペイロード出力
    write_jsonl(output_file, requests)
    
    logger.info("=" * 80)
    logger.info("✅ Pass1 Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info(f"\nOutput file: {output_file}")
    logger.info(f"Total requests: {len(requests)}")
    logger.info(f"\nNext steps:")
    logger.info(f"  1. python3 1_3_submit_batch.py")
    logger.info(f"  2. python3 1_4_poll_batch.py")


if __name__ == "__main__":
    main()
