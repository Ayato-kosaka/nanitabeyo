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
    
    # #548 【設計】ラベル定義（menu blacklist classification）
    VALID_LABELS_548 = ["keep", "too_generic", "non_menu_item", "not_for_menu", "uncertain"]
    
    # #550 【設計】決定（decision）定義（macro_genre A/B/C classification）
    VALID_DECISIONS_550 = ["A", "B", "C"]
    
    VALID_CONFIDENCE = ["high", "medium", "low"]
    
    def __init__(self, task: str = "menu_blacklist", examples_file: str = None):
        """
        Args:
            task: タスク識別子（"menu_blacklist" or "macro_genre"）
            examples_file: 教師データファイルのパス（省略時はタスクに応じたデフォルト）
        """
        self.task = task
        
        if examples_file is None:
            if task == "macro_genre":
                examples_file = Path(__file__).parent / "550_macro_genre" / "llm_examples_macro_genre.json"
            else:  # menu_blacklist
                examples_file = Path(__file__).parent / "548_wikidata_food_llm_labeling" / "llm_examples.json"
        
        self.examples = self._load_examples(examples_file)
        logger.info(f"Loaded {len(self.examples)} examples from {examples_file} for task={task}")
    
    @property
    def VALID_LABELS(self):
        """タスクに応じた有効なラベル/決定を返す"""
        if self.task == "macro_genre":
            return self.VALID_DECISIONS_550
        return self.VALID_LABELS_548
    
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
        if self.task == "macro_genre":
            return self._build_system_message_macro_genre()
        else:  # menu_blacklist
            return self._build_system_message_menu_blacklist()
    
    def _build_system_message_menu_blacklist(self) -> str:
        """#548 menu blacklist 用の system メッセージ"""
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
        """#550 macro_genre A/B/C 分類用の system メッセージ"""
        # #550 【設計】LLM プロンプト - system メッセージ
        system_prompt = """You are a food macro-genre normalizer and blacklist classifier for a recommendation app "Nani Tabeyo".

Your task is to classify Wikidata food-related items into exactly one of these three decisions:

A = blacklist (not a menu choice / meta / industry / region or designation / branded SKU)
B = self macro (is food/drink but cannot be safely normalized to a generic macro genre)
C = map_to_macro (is food/drink and can be normalized to a reusable generic macro genre)

Decision definitions:

A (blacklist):
  Use when the item is NOT suitable as a menu choice:
  - Meta/classification/concept: "class", "type", "category", "umbrella term", "industry", "skill", "product"
  - Industry/statistical classifications: OKPD/CPA codes, industry categories
  - Production/geography/designation: "viticulture", "wine region", "D.O.", "AOC", "designation of origin"
  - Branded products/SKU: brand names, manufactured products, chain SKUs, candy brands, beverage brands
  Examples: "Piemonte" (wine region), "viticulture of Aguascalientes", "Dog milk", "Oreo"

B (self macro):
  Use when the item IS food/drink but you cannot confidently normalize it to a generic macro:
  - Thin/missing description
  - Regional/traditional dishes where the generic macro is unclear
  - Proper nouns or local names that resist generalization
  - When you would assign confidence=low for decision C
  Examples: "Toast skagen" (Swedish dish - could be sandwich/toast but unclear), "Laufabrauð", "chipa"

C (map_to_macro):
  Use when the item IS clearly food/drink AND can be normalized to a reusable generic macro genre.
  Output a short, generic, reusable name (lower_snake_case) that represents the broader category:
  - Use generic terms: "ramen", "curry", "cookie", "sandwich", "bread", "cake", "wine", "tea", "cocktail", "salad"
  - NO proper nouns: NOT "toast_skagen", NOT "friuli_grave_pinot_nero", NOT "oreo"
  - NO brand names or region names
  - Collapse variants to parent: "shoyu_ramen" -> "ramen", "oatmeal_cookie" -> "cookie"
  - Keep it short: 1-2 words max
  - Wine styles are OK: "sweet_wine", "red_wine", "sparkling_wine" (NOT regional designations)
  Examples:
    - "Caesar salad" -> C, macro_genre="salad"
    - "Oatmeal cookie" -> C, macro_genre="cookie"
    - "Beerenauslese" (German wine term) -> C, macro_genre="sweet_wine"
    - "Shoyu ramen" -> C, macro_genre="ramen"

Important rules:

1. Output format must be strict JSON with these fields:
   - decision: "A" or "B" or "C"
   - confidence: "high" or "medium" or "low"
   - macro_genre: required ONLY if decision="C", otherwise omit or null
   - reason: short explanation (<= 20 words, <= 120 characters)

2. If decision=C, macro_genre must be:
   - A generic, reusable category name
   - lower_snake_case format
   - NOT a proper noun, region, or brand
   - Short (1-2 words)

3. If you cannot confidently assign a generic macro, choose B instead of guessing C.

4. Use label_en and desc_en as primary inputs. If missing/unclear, prefer B over risky C.

5. Wine regions, D.O. designations, viticulture -> A (blacklist)
   Wine styles (sweet wine, red wine, dessert wine) -> C with generic macro

Examples (for reference):
"""
        
        # #550 【設計】教師データを埋め込み（few-shot learning）
        for example in self.examples[:40]:  # macro_genre は 40 件程度
            label_en = (example.get("label_en") or "").strip()
            desc_en = (example.get("desc_en") or "").strip()
            decision = example.get("decision") or ""
            confidence = example.get("confidence") or ""
            macro_genre = example.get("macro_genre") or ""
            reason = example.get("reason") or ""
            
            if desc_en:
                example_str = f'- "{label_en}" (desc: "{desc_en}") -> decision={decision}, confidence={confidence}'
            else:
                example_str = f'- "{label_en}" -> decision={decision}, confidence={confidence}'
            
            if decision == "C" and macro_genre:
                example_str += f', macro_genre="{macro_genre}"'
            if reason:
                example_str += f', reason="{reason}"'
            
            system_prompt += example_str + '\n'
        
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
        タスクに応じた tool spec を返す
        
        Args:
            n_items: アイテム数
            
        Returns:
            tool specification
        """
        if self.task == "macro_genre":
            return self._tool_spec_macro_genre(n_items)
        else:  # menu_blacklist
            return self._tool_spec_menu_blacklist(n_items)
    
    def _tool_spec_menu_blacklist(self, n_items: int) -> Dict[str, Any]:
        """#548 menu blacklist 用の tool spec"""
        # 壊れない構造 を tools の parameters で縛る
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
        """#550 macro_genre A/B/C 分類用の tool spec"""
        spec = {
            "type": "function",
            "function": {
                "name": "submit_labels",
                "description": "Submit macro genre classification decisions for the provided Wikidata items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "item_qid": {"type": "string"},
                                    "decision": {"type": "string", "enum": self.VALID_DECISIONS_550},
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
                conf = r.get("confidence")
                reason = r.get("reason") or ""
                
                # タスク別のバリデーション
                if self.task == "macro_genre":
                    # #550 macro_genre task
                    decision = r.get("decision")
                    if decision not in self.VALID_DECISIONS_550:
                        return None, ParseError("invalid_decision", f"Invalid decision: {decision}")
                    # macro_genre は decision=C のときのみチェック
                    if decision == "C":
                        macro_genre = r.get("macro_genre") or ""
                        if not macro_genre:
                            return None, ParseError("missing_macro_genre", "macro_genre required for decision=C")
                else:
                    # #548 menu_blacklist task
                    label = r.get("label")
                    if label not in self.VALID_LABELS:
                        return None, ParseError("invalid_label", f"Invalid label: {label}")
                
                # 共通バリデーション
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
