#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_prepare_region_batch_payload.py

【目的】
region_targets_*.jsonl を読み込み、OpenAI Batch API 用のペイロードを生成する

【処理内容】
1. /tmp/wikidata_food_region_gate/region_targets_*.jsonl を読み込む
2. 20件ずつバッチにまとめる
3. Batch API 用の JSONL を生成（1行1リクエスト）
4. tools + tool_choice による構造化出力で JSON破損を防ぐ

【使用方法】
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1

【出力】
/tmp/wikidata_food_region_gate/batch_payload_scope_global.jsonl
/tmp/wikidata_food_region_gate/batch_payload_country_jp.jsonl
"""

import json
import logging
import argparse
from pathlib import Path
from typing import List, Dict, Optional

# #557 【設計】region gate 専用モジュールをインポート
from region_gate_prompt import build_system_prompt
from region_gate_schema import build_tool_spec

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 入出力先
INPUT_DIR = Path("/tmp/wikidata_food_region_gate")
OUTPUT_DIR = INPUT_DIR

# バッチサイズ
BATCH_SIZE = 10  # #557 【設計】1リクエストあたり10件

# market 定義
VALID_MARKETS = ["scope:global", "country:JP"]

# #557 【設計】model 定義（gpt-4.1-mini を使用）
MODEL_NAME = "gpt-4.1-mini"


def load_examples(market: str) -> List[Dict]:
    """
    market に応じた教師データを読み込む
    
    Args:
        market: 'scope:global' or 'country:JP'
        
    Returns:
        教師データのリスト
    """
    if market == "scope:global":
        examples_file = Path(__file__).parent / "llm_examples_region_global.json"
    elif market == "country:JP":
        examples_file = Path(__file__).parent / "llm_examples_region_country_jp.json"
    else:
        raise ValueError(f"Unknown market: {market}")
    
    with open(examples_file, 'r', encoding='utf-8') as f:
        examples = json.load(f)
    
    logger.info(f"Loaded {len(examples)} examples from {examples_file}")
    return examples


def load_items(filepath: Path) -> List[Dict]:
    """
    region_targets_*.jsonl を読み込む
    
    Args:
        filepath: region_targets_*.jsonl のパス
        
    Returns:
        アイテムのリスト
    """
    items = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    
    logger.info(f"Loaded {len(items)} items from {filepath}")
    return items


def create_batches(items: List[Dict], batch_size: int) -> List[List[Dict]]:
    """
    アイテムをバッチに分割する
    
    Args:
        items: アイテムのリスト
        batch_size: バッチサイズ
        
    Returns:
        バッチのリスト
    """
    batches = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        batches.append(batch)
    
    logger.info(f"Created {len(batches)} batches (size={batch_size})")
    return batches


MAX_DESC_CHARS = 200


PREFERRED_GLOBAL_LABEL_LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "sv", "no", "da", "fi", "pl", "cs", "tr", "ar", "he", "hi", "th", "vi", "id", "ms", "zh", "ko", "ja"]
PREFERRED_GLOBAL_DESC_LANGS  = ["en", "es", "fr", "de", "pt", "it", "zh", "ja", "ko"]

def pick_lang_text(d: Dict, langs: list[str]) -> tuple[str, str]:
    """
    d: {"en": "...", "ja": "...", ...} 形式を想定
    return: (text, lang) / 見つからなければ ("", "")
    """
    if not isinstance(d, dict):
        return "", ""
    for lang in langs:
        v = d.get(lang)
        if isinstance(v, str) and v.strip():
            return v, lang
    # fallback: 何でもいいから最初の非空
    for lang, v in d.items():
        if isinstance(v, str) and v.strip():
            return v, lang
    return "", ""

def normalize_item(it: Dict, market: str) -> Dict:
    def clean_text(s: str) -> str:
        s = (s or "").strip()
        s = " ".join(s.split())
        return s

    labels_json = it.get("labels_json") or {}
    descs_json  = it.get("descriptions_json") or {}

    label_en = clean_text(it.get("label_en"))
    label_ja = clean_text(it.get("label_ja"))
    desc_en  = clean_text(it.get("desc_en"))[:MAX_DESC_CHARS]
    desc_ja  = clean_text(it.get("desc_ja"))[:MAX_DESC_CHARS]

    wiki_presence = extract_wiki_presence(it.get("sitelinks_json"))  # {"jawiki":bool,"enwiki":bool}
    aliases_top = extract_top_aliases(it.get("aliases_json"), market=market, max_n=3)
    fallback_alias = clean_text(aliases_top[0]) if aliases_top else ""

    # 多言語からの代表ラベル/説明（global用）
    label_any, label_any_lang = pick_lang_text(labels_json, PREFERRED_GLOBAL_LABEL_LANGS)
    desc_any,  desc_any_lang  = pick_lang_text(descs_json,  PREFERRED_GLOBAL_DESC_LANGS)

    # jawiki タイトル fallback
    jawiki_title = extract_wiki_title(it.get("sitelinks_json"), "ja") or ""

    out = {
        "item_qid": it.get("item_qid"),
        "aliases_top": aliases_top,
        "wiki_presence": wiki_presence,
        # 将来の分析・デバッグに効く
        "sitelinks_count": count_sitelinks(it.get("sitelinks_json")),
        "labels_count": count_labels(it.get("labels_json")),
    }
    roots = it.get("roots") or []  # [{"root_qid":"Q..","kind":"dish","min_depth":2}, ...]
    primary_root = pick_primary_root(roots);
    out["primary_kind"] = pick_primary_kind(roots)
    out["kind_confidence"] = pick_kind_confidence(roots)

    if market == "country:JP":
        # JPは「日本語で自然に言えるか」が主戦場なので label_ja を必ず埋める
        label_ja = clean_text(label_ja) or clean_text(jawiki_title) or fallback_alias
        label_fallback = clean_text(label_en) or clean_text(label_any)
        desc_ja_final  = clean_text(desc_ja)[:MAX_DESC_CHARS] or clean_text(desc_any)[:MAX_DESC_CHARS]

        out.update({
            "label_ja": label_ja,
            "desc_ja": desc_ja_final,
            "label_en": clean_text(label_en),
            "desc_en": clean_text(desc_en) or "(no description)",
        })
        return out

    if market == "scope:global":
        # Globalは英語優先。ただし無い場合は多言語から拾う（拾った言語も明示）
        label_primary = clean_text(label_en) or clean_text(label_any) or clean_text(label_ja) or fallback_alias
        desc_primary  = clean_text(desc_en)  or clean_text(desc_any)  or clean_text(desc_ja)

        out.update({
            "label_primary": label_primary,
            "desc_primary": desc_primary[:MAX_DESC_CHARS] or "(no description)",
            "label_primary_lang": ("en" if clean_text(label_en) else (label_any_lang or ("ja" if clean_text(label_ja) else ""))),
            "desc_primary_lang":  ("en" if clean_text(desc_en)  else (desc_any_lang  or ("ja" if clean_text(desc_ja)  else ""))),
        })
        return out

    return out

import json
from typing import List, Dict, Any

MAX_ALIAS_CHARS = 30


def extract_top_aliases(aliases_json: Any, market: str, max_n: int = 3) -> List[str]:
    """
    Wikidata aliases_json から上位 alias を抽出する
    - market=country:JP → ja 優先
    - market=scope:global → en 優先
    - 最大 max_n 件
    - 各 alias は trim & 文字数制限
    """
    if not aliases_json:
        return []

    try:
        data = aliases_json if isinstance(aliases_json, dict) else json.loads(aliases_json)
    except Exception:
        return []

    aliases: List[str] = []

    # 言語優先順位
    if market == "country:JP":
        lang_order = ["ja"]
    else:
        lang_order = ["en", "ja"]

    # 言語別 aliases
    if isinstance(data, dict):
        for lang in lang_order:
            vals = data.get(lang)
            if isinstance(vals, list):
                for v in vals:
                    if isinstance(v, str):
                        aliases.append(v)

    # dict でなかった場合（配列だけ等）
    elif isinstance(data, list):
        for v in data:
            if isinstance(v, str):
                aliases.append(v)

    # 正規化・短縮・重複除去
    cleaned: List[str] = []
    seen = set()
    for a in aliases:
        a = " ".join(a.strip().split())
        if not a:
            continue
        a = a[:MAX_ALIAS_CHARS]
        key = a.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(a)
        if len(cleaned) >= max_n:
            break

    return cleaned

def pick_primary_root(roots: List[Dict]) -> Optional[Dict]:
    if not roots:
        return None
    roots_sorted = sorted(roots, key=lambda r: (r.get("min_depth", 9999), 
                                                 0 if r.get("kind") == "dish" else
                                                 1 if r.get("kind") == "beverage" else
                                                 2 if r.get("kind") == "dessert" else
                                                 3))
    primary_root = roots_sorted[0]
    return primary_root

def pick_primary_kind(roots: List[Dict]) -> str:
    primary_root = pick_primary_root(roots)
    if not primary_root:
        return ""
    kind = primary_root.get("kind")
    if kind in ["dish", "beverage", "dessert"]:
        return kind
    return ""
  
def pick_kind_confidence(roots: List[Dict]) -> str:
    primary_root = pick_primary_root(roots)
    if not primary_root:
        return "low"
    depth = primary_root.get("min_depth", 9999)
    if depth <= 2:
        return "high"
    elif depth <= 4:
        return "medium"
    else:
        return "low"

def count_sitelinks(sitelinks_json: Any) -> int:
    if not sitelinks_json:
        return 0

    try:
        data = sitelinks_json if isinstance(sitelinks_json, dict) else json.loads(sitelinks_json)
    except Exception:
        return 0

    if not isinstance(data, dict):
        return 0

    return len(data.keys())

def count_labels(labels_json: Any) -> int:
    if not labels_json:
        return 0

    try:
        data = labels_json if isinstance(labels_json, dict) else json.loads(labels_json)
    except Exception:
        return 0

    if not isinstance(data, dict):
        return 0

    return len(data.keys())

def extract_wiki_presence(sitelinks_json: Any) -> Dict[str, bool]:
    if not sitelinks_json:
        return {"jawiki": False, "enwiki": False}

    try:
        s = sitelinks_json if isinstance(sitelinks_json, str) else json.dumps(sitelinks_json)
    except Exception:
        return {"jawiki": False, "enwiki": False}

    return {
        "jawiki": "ja.wikipedia.org" in s,
        "enwiki": "en.wikipedia.org" in s,
    }

from urllib.parse import unquote

def extract_wiki_title(sitelinks_json: Any, lang: str) -> Optional[str]:
    key = f"https://{lang}.wikipedia.org/"

    try:
        sitelinks_str = sitelinks_json if isinstance(sitelinks_json, str) else json.dumps(sitelinks_json)

        start_index = sitelinks_str.find(key)
        if start_index == -1:
            return None

        url = sitelinks_str[start_index:].split('"')[0]  # Assume URLs are enclosed in quotes
        title = unquote(url.split("/wiki/")[1])

        return title
    except Exception:
        return None


import re

def bucket_wiki_lang_count(sitelinks_json: Any) -> str:
    if not sitelinks_json:
        return "0"

    try:
        s = sitelinks_json if isinstance(sitelinks_json, str) else json.dumps(sitelinks_json)
    except Exception:
        return "0"

    # wikipedia.org ドメイン数をざっくり数える
    langs = set(re.findall(r"https://([a-z\-]+)\.wikipedia\.org", s))
    n = len(langs)

    if n == 0:
        return "0"
    if n == 1:
        return "1"
    if n <= 3:
        return "2-3"
    return "4+"

def bucket_label_lang_count(labels_json: Any) -> str:
    if not labels_json:
        return "1"

    try:
        data = labels_json if isinstance(labels_json, dict) else json.loads(labels_json)
    except Exception:
        return "1"

    if not isinstance(data, dict):
        return "1"

    n = len(data.keys())

    if n <= 1:
        return "1"
    if n <= 3:
        return "2-3"
    return "4+"


def create_batch_request(items: List[Dict], custom_id: str, system_prompt: str, examples: List[Dict], model: str) -> Dict:
    """
    OpenAI Batch API 用のリクエストを生成
    
    Args:
        items: アイテムのリスト
        custom_id: カスタムID（リクエスト識別用）
        system_prompt: system プロンプト
        examples: 教師データのリスト
        model: モデル名
        
    Returns:
        Batch API 用のリクエスト辞書
    """
    # user message を JSON で生成
    user_message = json.dumps({"items": items}, ensure_ascii=False, separators=(",", ":"))
    
    # tool spec 生成
    tool_spec = build_tool_spec(len(items))
    
    # #557 【設計】Batch API リクエスト構築
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                # #557 【設計】教師データを role:user で渡す（10〜16件に絞る）
                # 特にトークンが重いのと、reason が長くなりがちでモデルの文体に影響するため廃止
                # {
                #     "role": "user",
                #     "content": "TRAINING_EXAMPLES_JSON (soft guidance; do not copy decisions blindly):\n"
                #         + json.dumps({"examples": examples[:16]}, ensure_ascii=False, separators=(",", ":"))
                # },
                {"role": "user", "content": user_message},
            ],
            "tools": [tool_spec],
            "tool_choice": {"type": "function", "function": {"name": "submit_region_gate_decisions"}},
            "temperature": 0.0
        }
    }


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(description="Prepare region batch payload for OpenAI Batch API")
    parser.add_argument(
        "--market",
        type=str,
        required=True,
        choices=VALID_MARKETS,
        help="Market to prepare payload for (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run-id",
        type=str,
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    args = parser.parse_args()
    
    market = args.market
    run_id = args.run_id
    
    logger.info("=" * 80)
    logger.info("Step 1-2: Preparing region batch payload for OpenAI Batch API")
    logger.info("=" * 80)
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Model: {MODEL_NAME}")
    
    # 入力ファイル決定
    market_safe = market.replace(":", "_")
    input_file = INPUT_DIR / f"region_targets_{market_safe}.jsonl"
    output_file = OUTPUT_DIR / f"batch_payload_{market_safe}.jsonl"
    
    # 入力ファイル確認
    if not input_file.exists():
        logger.error(f"Input file not found: {input_file}")
        logger.error(f"Please run 1_1_export_region_label_targets.py --market {market} first")
        return
    
    # アイテム読み込み
    items = load_items(input_file)
    
    if not items:
        logger.warning("No items to process")
        return
    
    # アイテム正規化
    items = [normalize_item(it, market) for it in items]
    
    # バッチに分割
    batches = create_batches(items, BATCH_SIZE)
    
    # #557 【設計】教師データ読み込み
    examples = load_examples(market)
    
    # #557 【設計】system prompt 生成（market 別）
    system_prompt = build_system_prompt(market)
    logger.info(f"Generated system prompt for market={market}")
    
    # Batch API 用のペイロード生成
    logger.info(f"Generating batch payload...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, batch in enumerate(batches):
            custom_id = f"batch_{idx:05d}"
            request = create_batch_request(batch, custom_id, system_prompt, examples, MODEL_NAME)
            f.write(json.dumps(request, ensure_ascii=False) + '\n')
    
    logger.info(f"Successfully generated batch payload: {len(batches)} requests")
    logger.info("=" * 80)
    logger.info("✅ Step 1-2 completed successfully!")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Output file:")
    logger.info(f"  {output_file}")
    logger.info("")
    logger.info("Next steps:")
    logger.info(f"  1. Upload {output_file.name} to OpenAI Batch API")
    logger.info("  2. Wait for batch processing to complete")
    logger.info("  3. Download results.jsonl")
    logger.info(f"  4. Run: python3 1_3_load_region_llm_results.py --market {market} --run-id {run_id} --input results.jsonl")


if __name__ == "__main__":
    main()
