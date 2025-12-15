#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
llm_client.py

【目的】
gpt-4.1-mini によるラベリングリクエストを組み立てるユーティリティ

【機能】
- 教師データ（llm_examples.json）の読み込み
- system メッセージの生成（教師データ埋め込み）
- user メッセージの生成（20件前後のバッチ）
- レスポンスのパース
"""

import json
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict, Any

logger = logging.getLogger(__name__)


@dataclass
class ParseError:
    code: str
    message: str


class LLMClient:
    """LLM クライアント - プロンプト管理とリクエスト組み立て"""
    
    # #548 【設計】ラベル定義
    VALID_LABELS = ["keep", "too_generic", "non_menu_item", "not_for_menu", "uncertain"]
    VALID_CONFIDENCE = ["high", "medium", "low"]
    
    def __init__(self, examples_file: str = None):
        """
        Args:
            examples_file: 教師データファイルのパス（デフォルト: llm_examples.json）
        """
        if examples_file is None:
            examples_file = Path(__file__).parent / "llm_examples.json"
        
        self.examples = self._load_examples(examples_file)
        logger.info(f"Loaded {len(self.examples)} examples from {examples_file}")
    
    def _load_examples(self, filepath: str) -> List[Dict]:
        """
        教師データを読み込む
        
        Args:
            filepath: llm_examples.json のパス
            
        Returns:
            教師データのリスト
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            examples = json.load(f)
        
        logger.info(f"Loaded {len(examples)} examples")
        return examples
    
    def build_system_message(self) -> str:
        """
        system メッセージを構築する（教師データを含む）
        
        Returns:
            system メッセージ文字列
        """
        # #548 【設計】LLM プロンプト - system メッセージ
        system_prompt = """You are a data labeler for a gourmet recommendation app called "Nani Tabeyo".
Your task is to classify Wikidata food-related items into one of the following labels:

- keep
- too_generic
- non_menu_item
- not_for_menu
- uncertain

Definitions:

- keep:
  The item is a dish, beverage, dessert, snack, or cuisine category that real people might say
  when deciding what to eat or drink. Examples:
  - specific dishes: "Samgyeopsal", "Ogikubo ramen", "stinky tofu"
  - cuisine categories: "Korean cuisine", "Italian cuisine", "ramen", "udon"
  - menu-like items: "muffin", "sandwich", "almond milk", "Sicilian pizza", "stew", "salad".

- too_generic:
  The item is food-related, but it is a broad category or abstract class that is too generic
  to be shown as a direct menu choice. Examples:
  - "food", "human food", "dish", "sweet dish", "meat dish", "seafood dish"
  - "rice dish", "noodle", "noodle dish", "poultry dish", "pork dish", "beef dish"
  - "plant-based food", "cereal product", "flour-based food"
  - "non-alcoholic beverage", "sugary drink", "alcopop", "malt beverage"
  - "food ingredient".
  If it sounds like an abstract type/class rather than something you would actually choose to eat today,
  label it as "too_generic".

- non_menu_item:
  The item is NOT a concrete food or drink choice.
  Examples:
  - abstract concepts: "class", "skill", "notion", "umbrella term", "commodity", "industry"
  - meta-entities: "product", "type of manufactured good", "version"
  - meta pages: "Wikimedia list article"
  - industrial classifications: "food products by OKPD2 (10)",
    "Production of food industry by OKP"
  - viticulture or production-only concepts: "viticulture of Aguascalientes"
  - fictional-only or game-only recipes: "Papa Louie special recipe".
  If it is clearly not a real-world food/drink choice, use "non_menu_item".

- not_for_menu:
  The item is food or drink related, but we DO NOT want to show it as a choice in this app.
  Examples:
  - candy and candy brands: "candy", "Wax lips", "Oreo sandwich cookie", "Opatów krówki"
  - chewing gum and functional gum: "functional chewing gum"
  - packaged snack or instant food brands: "Nissin Yakisoba UFO", "Deutsches Reichsbräu"
  - supermarket drink brands: "Cola up", "Kola Román", "Sun Drop", "Sam's Choice"
  - strong alcohol brands as products: "Heaven Hill Kentucky Whiskey", "Biancosarti".
  These are technically edible/drinkable, but behave more like branded products/snacks
  than restaurant dishes or cuisine choices.

- uncertain:
  Use this only when there is not enough information, or when the item is ambiguous
  and you are not confident. Prefer "uncertain" instead of guessing.

Important rules:

1. Always output exactly one label from:
   ["keep", "too_generic", "non_menu_item", "not_for_menu", "uncertain"].

2. Think from the perspective of a user chatting with friends:
   "What should we eat today?" → would they naturally say this word or phrase?

3. Do NOT create new labels. Use only the five allowed labels.

4. Prioritize the semantics of label_en and desc_en. Use other language fields only as hints.

5. When in doubt between "keep" and "too_generic":
   - Concrete dish/cuisine/menu item → "keep"
   - Broad category type → "too_generic"

6. When in doubt between "keep" and "not_for_menu":
   - Branded snack, candy bar, gum, or supermarket drink → "not_for_menu"
   - Typical restaurant dish or cuisine style → "keep"

Examples (for reference):
"""
        
        # #548 【設計】教師データを埋め込み（few-shot learning）
        for example in self.examples[:30]:  # 最初の30件を使用
            label_en = (example.get("label_en" or "")).strip()
            desc_en = (example.get("desc_en") or "").strip()
            target = example.get("target_label" or "")
            if desc_en:
                system_prompt += f'- "{label_en}" (desc: "{desc_en}") -> {target}\n'
            else:
                system_prompt += f'- "{label_en}" -> {target}\n'
        
        return system_prompt
    
    def build_user_message(self, items: List[Dict]) -> str:
        """
        user メッセージを構築する（20件前後のバッチ）
        
        Args:
            items: アイテムのリスト [{'item_qid': 'Q...', 'label_en': '...', 'desc_en': '...'}, ...]
            
        Returns:
            user メッセージ文字列（JSON）
        """
        payload = {"items": items}
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    
    def build_output_format_instruction(self) -> str:
        """
        出力フォーマット指示を構築する
        
        Returns:
            出力フォーマット指示文字列
        """
        return """Return your answer ONLY by calling the provided tool function.

Reason rule:
- reason must be <= 20 words AND <= 120 characters."""

    def _tool_spec(self, n_items: int) -> Dict[str, Any]:
        # “壊れない構造” を tools の parameters で縛る
        spec = {
            "type": "function",
            "function": {
                "name": "submit_labels",
                "description": "Submit labels for the provided Wikidata items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "item_qid": {"type": "string"},
                                    "label": {"type": "string", "enum": self.VALID_LABELS},
                                    "confidence": {"type": "string", "enum": self.VALID_CONFIDENCE},
                                    "reason": {"type": "string", "maxLength": 120}
                                },
                                "required": ["item_qid", "label", "confidence", "reason"],
                                "additionalProperties": False
                            }
                        }
                    },
                    "required": ["results"],
                    "additionalProperties": False
                }
            }
        }
        spec["function"]["parameters"]["properties"]["results"]["minItems"] = n_items
        spec["function"]["parameters"]["properties"]["results"]["maxItems"] = n_items
        return spec
    
    def create_batch_request(self, items: List[Dict], custom_id: str) -> Dict:
        """
        OpenAI Batch API 用のリクエストを生成
        
        Args:
            items: アイテムのリスト
            custom_id: カスタムID（リクエスト識別用）
            
        Returns:
            Batch API 用のリクエスト辞書
        """
        system_message = self.build_system_message()
        user_message = self.build_user_message(items)
        system_message += "\n" + self.build_output_format_instruction()
        
        return {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": "gpt-4.1-mini",
                "messages": [
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": user_message},
                ],
                "tools": [self._tool_spec(len(items))],
                "tool_choice": {"type": "function", "function": {"name": "submit_labels"}},
                "temperature": 0.0
            }
        }
    
    def parse_response(self, response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                    ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
        """
        response_obj: OpenAI APIのレスポンス（JSON）
        expected_items: 入力items（順序・件数検証に使う）
        """
        try:
            choice = response_obj["choices"][0]
            msg = choice["message"]

            # tool_calls がある想定
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                return None, ParseError("no_tool_calls", "No tool_calls in response")

            call0 = tool_calls[0]
            fn = call0.get("function", {})
            if fn.get("name") != "submit_labels":
                return None, ParseError("wrong_function", f"Unexpected function: {fn.get('name')}")

            args_str = fn.get("arguments", "")
            try:
                args = json.loads(args_str)
            except Exception as e:
                return None, ParseError("bad_arguments_json", f"Failed to parse function arguments JSON: {e}")

            results = args.get("results")
            if not isinstance(results, list):
                return None, ParseError("missing_results", "Missing or invalid 'results'")

            # 件数/順序検証
            if expected_items is not None:
                if len(results) != len(expected_items):
                    return None, ParseError(
                        "length_mismatch",
                        f"results length {len(results)} != expected {len(expected_items)}"
                    )
                # item_qidが一致しているか（順序一致も担保）
                for r, exp in zip(results, expected_items):
                    if r.get("item_qid") != exp.get("item_qid"):
                        return None, ParseError(
                            "qid_mismatch",
                            f"item_qid mismatch: {r.get('item_qid')} != {exp.get('item_qid')}"
                        )

            # 値のバリデーション
            validated = []
            for r in results:
                label = r.get("label")
                conf = r.get("confidence")
                reason = r.get("reason") or ""
                if label not in self.VALID_LABELS:
                    return None, ParseError("invalid_label", f"Invalid label: {label}")
                if conf not in self.VALID_CONFIDENCE:
                    return None, ParseError("invalid_confidence", f"Invalid confidence: {conf}")
                if len(reason) > 120:
                    # ここは「切って許容」でもいいが、ミス許容しない方針なら落とす
                    return None, ParseError("reason_too_long", f"Reason too long: {len(reason)} chars")
                if len(reason.split()) > 20:
                    return None, ParseError("reason_too_many_words", f"Reason too many words: {len(reason.split())} words")
                validated.append(r)
        
            return validated, None

        except Exception as e:
            return None, ParseError("unexpected", str(e))
