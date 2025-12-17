#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
llm_client.py

【目的】
gpt-4.1-mini によるラベリングリクエストを組み立てるユーティリティ

【機能】
- 教師データの読み込み（#548用 / #550用）
- system メッセージの生成（教師データ埋め込み）
- user メッセージの生成（20件前後のバッチ）
- レスポンスのパース
- #548 メニューブラックリスト分類と #550 macro_genre ABC分類の両方をサポート
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
    
    # #550 【設計】decision 定義
    VALID_DECISIONS = ["A", "B", "C"]
    
    # #557 【設計】region decision 定義
    VALID_REGION_DECISIONS = ["allow", "deny", "uncertain"]
    
    VALID_CONFIDENCE = ["high", "medium", "low"]
    
    def __init__(self, task: str = "menu_blacklist", examples_file: str = None, market_key: str = None):
        """
        Args:
            task: "menu_blacklist" (#548) or "macro_genre" (#550) or "region" (#557)
            examples_file: 教師データファイルのパス（デフォルトは task に応じて自動設定）
            market_key: region タスク用の market 識別子（"scope:global" or "country:JP"）
        """
        self.task = task
        self.market_key = market_key
        
        if examples_file is None:
            if task == "menu_blacklist":
                examples_file = Path(__file__).parent / "548_wikidata_food_llm_labeling" / "llm_examples.json"
            elif task == "macro_genre":
                examples_file = Path(__file__).parent / "550_macro_genre" / "llm_examples_macro_genre.json"
            elif task == "region":
                # #557 【設計】market_key に応じて異なる examples を使用
                if market_key == "scope:global":
                    examples_file = Path(__file__).parent / "557_region" / "llm_examples_region_global.json"
                elif market_key == "country:JP":
                    examples_file = Path(__file__).parent / "557_region" / "llm_examples_region_country_jp.json"
                else:
                    raise ValueError(f"Unknown market_key for region task: {market_key}")
            else:
                raise ValueError(f"Unknown task: {task}")
        
        self.examples = self._load_examples(examples_file)
        logger.info(f"Loaded {len(self.examples)} examples from {examples_file} for task={task}")
    
    def _load_examples(self, filepath: str) -> List[Dict]:
        """
        教師データを読み込む
        
        Args:
            filepath: 教師データファイルのパス
            
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
        if self.task == "menu_blacklist":
            return self._build_system_message_menu_blacklist()
        elif self.task == "macro_genre":
            return self._build_system_message_macro_genre()
        elif self.task == "region":
            return self._build_system_message_region()
        else:
            raise ValueError(f"Unknown task: {self.task}")
    
    def _build_system_message_menu_blacklist(self) -> str:
        """#548 用 system メッセージ"""
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
            label_en = (example.get("label_en") or "").strip()
            desc_en = (example.get("desc_en") or "").strip()
            target = example.get("target_label") or ""
            if desc_en:
                system_prompt += f'- "{label_en}" (desc: "{desc_en}") -> {target}\n'
            else:
                system_prompt += f'- "{label_en}" -> {target}\n'
        
        return system_prompt
    
    def _build_system_message_macro_genre(self) -> str:
        """#550 用 system メッセージ"""
        # #550 【設計】LLM プロンプト - system メッセージ
        system_prompt = """You classify Wikidata food-related items into A, B, or C.

A = blacklist:
Concepts that are not edible menu items, including:
- classifications, industries, production, standards
- regions, geographic designations, appellations
- food cultures or eating styles (e.g. street food, vegetarian cuisine)
- brands or company-specific SKUs

B = food-related grouping term (rare):
Established cuisines or culinary traditions that are not specific dishes
or drinks (e.g. Swedish cuisine, Kaiseki).

Do NOT use B for food styles, restrictions, or eating formats
(e.g. vegetarian food, halal food, street food), which should be A.

C = dish / drink / item:
Concrete edible items that can be eaten or drunk.

For C:
- Normalize to a macro genre to enable grouping.
- If the item is a clear variant, map to its parent (e.g. shoyu ramen -> ramen).
- If mapping would destroy meaning, keep the item itself as macro genre.

Output macro_genre using the Wikidata English label form.
Do NOT output regions, brands, or designation/industry terms as macro_genre.

If information is insufficient, lower confidence.
Always output strict JSON only.

Examples (for reference):
"""
        
        # #550 【設計】教師データを埋め込み（few-shot learning）
        for example in self.examples[:40]:  # 最初の40件を使用
            label_en = (example.get("label_en") or "").strip()
            desc_en = (example.get("desc_en") or "").strip()
            decision = example.get("decision") or ""
            macro_genre = example.get("macro_genre", "")
            
            if desc_en:
                if decision == "C" and macro_genre:
                    system_prompt += f'- "{label_en}" (desc: "{desc_en}") -> {decision}, macro_genre: {macro_genre}\n'
                else:
                    system_prompt += f'- "{label_en}" (desc: "{desc_en}") -> {decision}\n'
            else:
                if decision == "C" and macro_genre:
                    system_prompt += f'- "{label_en}" -> {decision}, macro_genre: {macro_genre}\n'
                else:
                    system_prompt += f'- "{label_en}" -> {decision}\n'
        
        return system_prompt
    
    def _build_system_message_region(self) -> str:
        """#557 用 system メッセージ"""
        # #557 【設計】LLM プロンプト - system メッセージ（region ホワイトリスト判定）
        system_prompt = f"""You are labeling whether a Wikidata food category should be allowed to appear in a food suggestion app
for a specific market.

Market is provided as: {self.market_key}
Examples:
- scope:global
- country:JP

Decide one of:
- allow: The item is a real, conversationally common food category/menu item name in that market.
- deny: Not common in that market, too obscure, or not a food category/menu item people would name.
- uncertain: Not enough evidence.

Rules:
- This is a distribution gate only (whitelist). If unsure, use "uncertain" with low confidence.
- Do not infer popularity from your own preferences. Use the evidence fields provided.
- Prefer "deny" for extremely local terms that are unlikely to be understood in the market.
- Prefer "allow" for globally common items (for scope:global) or commonly used in Japanese context (for country:JP).
- Deny cuisine categories (e.g. "Korean cuisine", "Italian cuisine"), cooking methods, ingredients, geographic locations.
- Deny cultural concepts, academic subjects, and abstract classifications.
- Allow specific dish/drink/menu items that people would naturally say when deciding what to eat.
- Output strict JSON only. No extra text.

Output format:
{{
  "results": [
    {{
      "item_qid": "Qxxxx",
      "decision": "allow|deny|uncertain",
      "confidence": "high|medium|low",
      "reason": "one short sentence"
    }}
  ]
}}

Examples (for reference):
"""
        
        # #557 【設計】教師データを埋め込み（few-shot learning）
        for example in self.examples[:30]:  # 最初の30件を使用
            label_en = (example.get("label_en") or "").strip()
            label_ja = (example.get("label_ja") or "").strip()
            desc_en = (example.get("desc_en") or "").strip()
            desc_ja = (example.get("desc_ja") or "").strip()
            decision = example.get("decision") or ""
            
            # #557 【設計】market に応じて label/desc を切り替え
            if self.market_key == "country:JP" and label_ja:
                label = label_ja
                desc = desc_ja if desc_ja else desc_en
            else:
                label = label_en
                desc = desc_en
            
            if desc:
                system_prompt += f'- "{label}" (desc: "{desc}") -> {decision}\n'
            else:
                system_prompt += f'- "{label}" -> {decision}\n'
        
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
        """
        Tool specification を生成（task に応じて異なるスキーマを返す）
        """
        if self.task == "menu_blacklist":
            return self._tool_spec_menu_blacklist(n_items)
        elif self.task == "macro_genre":
            return self._tool_spec_macro_genre(n_items)
        elif self.task == "region":
            return self._tool_spec_region(n_items)
        else:
            raise ValueError(f"Unknown task: {self.task}")
    
    def _tool_spec_menu_blacklist(self, n_items: int) -> Dict[str, Any]:
        """#548 用 tool spec"""
        # #548 【設計】"壊れない構造" を tools の parameters で縛る
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
    
    def _tool_spec_macro_genre(self, n_items: int) -> Dict[str, Any]:
        """#550 用 tool spec"""
        # #550 【設計】macro_genre 用のスキーマ
        spec = {
            "type": "function",
            "function": {
                "name": "submit_classifications",
                "description": "Submit A/B/C classifications for the provided Wikidata items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "item_qid": {"type": "string"},
                                    "decision": {"type": "string", "enum": self.VALID_DECISIONS},
                                    "confidence": {"type": "string", "enum": self.VALID_CONFIDENCE},
                                    "macro_genre": {"type": "string"},
                                    "reason": {"type": "string", "maxLength": 120}
                                },
                                "required": ["item_qid", "decision", "confidence", "reason"],
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
    
    def _tool_spec_region(self, n_items: int) -> Dict[str, Any]:
        """#557 用 tool spec"""
        # #557 【設計】region ホワイトリスト判定用のスキーマ
        spec = {
            "type": "function",
            "function": {
                "name": "submit_region_decisions",
                "description": "Submit region whitelist decisions for the provided Wikidata items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "item_qid": {"type": "string"},
                                    "decision": {"type": "string", "enum": self.VALID_REGION_DECISIONS},
                                    "confidence": {"type": "string", "enum": self.VALID_CONFIDENCE},
                                    "reason": {"type": "string", "maxLength": 120}
                                },
                                "required": ["item_qid", "decision", "confidence", "reason"],
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
        
        # #557 【設計】task に応じて tool_name を切り替え
        if self.task == "menu_blacklist":
            tool_name = "submit_labels"
        elif self.task == "macro_genre":
            tool_name = "submit_classifications"
        elif self.task == "region":
            tool_name = "submit_region_decisions"
        else:
            raise ValueError(f"Unknown task: {self.task}")
        
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
                "tool_choice": {"type": "function", "function": {"name": tool_name}},
                "temperature": 0.0
            }
        }
    
    def parse_response(self, response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                    ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
        """
        レスポンスをパース（task に応じて異なるパーサーを使用）
        
        Args:
            response_obj: OpenAI APIのレスポンス（JSON）
            expected_items: 入力items（順序・件数検証に使う）
            
        Returns:
            (parsed_results, error) のタプル
        """
        if self.task == "menu_blacklist":
            return self._parse_response_menu_blacklist(response_obj, expected_items)
        elif self.task == "macro_genre":
            return self._parse_response_macro_genre(response_obj, expected_items)
        elif self.task == "region":
            return self._parse_response_region(response_obj, expected_items)
        else:
            raise ValueError(f"Unknown task: {self.task}")
    
    def _parse_response_menu_blacklist(self, response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                    ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
        """#548 用パーサー"""
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
                    return None, ParseError("reason_too_long", f"Reason too long: {len(reason)} chars")
                if len(reason.split()) > 20:
                    return None, ParseError("reason_too_many_words", f"Reason too many words: {len(reason.split())} words")
                validated.append(r)
        
            return validated, None

        except Exception as e:
            return None, ParseError("unexpected", str(e))
    
    def _parse_response_macro_genre(self, response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                    ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
        """#550 用パーサー"""
        try:
            choice = response_obj["choices"][0]
            msg = choice["message"]

            # tool_calls がある想定
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                return None, ParseError("no_tool_calls", "No tool_calls in response")

            call0 = tool_calls[0]
            fn = call0.get("function", {})
            if fn.get("name") != "submit_classifications":
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
                decision = r.get("decision")
                conf = r.get("confidence")
                reason = r.get("reason") or ""
                macro_genre = r.get("macro_genre")
                
                if decision not in self.VALID_DECISIONS:
                    return None, ParseError("invalid_decision", f"Invalid decision: {decision}")
                if conf not in self.VALID_CONFIDENCE:
                    return None, ParseError("invalid_confidence", f"Invalid confidence: {conf}")
                if len(reason) > 120:
                    return None, ParseError("reason_too_long", f"Reason too long: {len(reason)} chars")
                if len(reason.split()) > 20:
                    return None, ParseError("reason_too_many_words", f"Reason too many words: {len(reason.split())} words")
                
                # #550 【設計】decision=C のときのみ macro_genre を"NULL"で上書き
                if decision == "C" and not macro_genre:
                    macro_genre = "NULL"
                
                validated.append(r)
        
            return validated, None

        except Exception as e:
            return None, ParseError("unexpected", str(e))
    
    def _parse_response_region(self, response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                    ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
        """#557 用パーサー"""
        try:
            choice = response_obj["choices"][0]
            msg = choice["message"]

            # tool_calls がある想定
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                return None, ParseError("no_tool_calls", "No tool_calls in response")

            call0 = tool_calls[0]
            fn = call0.get("function", {})
            if fn.get("name") != "submit_region_decisions":
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
                decision = r.get("decision")
                conf = r.get("confidence")
                reason = r.get("reason") or ""
                
                if decision not in self.VALID_REGION_DECISIONS:
                    return None, ParseError("invalid_decision", f"Invalid decision: {decision}")
                if conf not in self.VALID_CONFIDENCE:
                    return None, ParseError("invalid_confidence", f"Invalid confidence: {conf}")
                if len(reason) > 120:
                    return None, ParseError("reason_too_long", f"Reason too long: {len(reason)} chars")
                if len(reason.split()) > 20:
                    return None, ParseError("reason_too_many_words", f"Reason too many words: {len(reason.split())} words")
                
                validated.append(r)
        
            return validated, None

        except Exception as e:
            return None, ParseError("unexpected", str(e))
