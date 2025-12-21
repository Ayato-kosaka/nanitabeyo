#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_dine_out_orderability.py

【目的】
#575 dine_out_orderability (外食目的適性) 用の system/user prompt 組み立て関数

【機能】
- 外食目的適性スコア（0, 0.5, 1）付与
- market_salience（想起の強さ）とは独立して評価
"""

import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def build_system_prompt() -> str:
    """
    JP dine_out_orderability 用 system prompt
    
    【判定基準】
    - 外食目的適性を 0, 0.5, 1 の3段階で評価
    - 知名度・人気は評価しない（market_salience の責務）
    
    Returns:
        system prompt 文字列
    """
    return """You are assigning DINE-OUT ORDERABILITY for dish/drink categories
in a restaurant recommendation app.

Market: Japan (region:country:JP)

This task measures whether a category makes sense as something
users would "go out to eat" as a primary purpose.


========================
WHAT THIS MEASURES
========================

This score answers only one question:

"Does this category work as a dining-out destination purpose?"

Specifically:
- Can users realistically say, "Let's go eat [this category] at a restaurant"?
- Do restaurants/shops specialize in this category or feature it as a core menu item?


========================
WHAT THIS DOES NOT MEASURE
========================

This score explicitly IGNORES:

- Popularity / trendiness (handled by market_salience)
- Cultural importance / authenticity
- Wikipedia notability
- Personal preference
- Whether it's "traditional" or "modern"

Even if a category is extremely popular, if its main sales channel
is retail/grocery (e.g., packaged bread, canned coffee, snacks),
the score must be 0.


========================
SCORE DEFINITIONS
========================

Scores are discrete: 0 / 0.5 / 1

score = 1:
Users go to restaurants specifically to eat this category.
Dedicated shops or category-focused restaurants commonly exist.

Examples:
ラーメン, 寿司, カレー, 焼肉, うどん, そば, ピザ, パスタ,
餃子, 天ぷら, とんかつ, お好み焼き, たこ焼き

score = 0.5:
The category appears in restaurant menus,
but users rarely go out "specifically for this".
It may be a side dish, drink, or minor menu item.

Examples:
味噌汁, 漬物, 枝豆, ポテトサラダ, 緑茶（提供されるが目的にはならない）

score = 0:
The primary sales channel is retail/grocery (packaged products, home cooking).
Not suitable as a restaurant search term.

MUST be score = 0:
- Brand names (e.g., コカ・コーラ, カルピス, ポッキー)
- RTD (Ready-To-Drink) products
- Packaged foods (e.g., カップ麺, レトルトカレー)
- Ingredients/condiments (e.g., 醤油, 塩, 砂糖, 小麦粉)
- Home cooking basics (e.g., 白米, 食パン, バター)


========================
MANDATORY RULES
========================

1. Brand names / packaged products → MUST be score = 0

2. If desc_ja mentions brands, product names, or "〇〇社", "〇〇製" → score = 0

3. Ingredients, seasonings, raw materials → score = 0

4. Abstract categories that are not orderable
   (e.g., 調味料, 穀物, 乳製品) → score = 0

5. When in doubt between 0 and 0.5, or between 0.5 and 1:
   → Choose the LOWER score to avoid false positives


========================
CONFIDENCE GUIDELINES
========================

high:
- Clear judgment
- Category is obviously orderable or obviously not orderable

medium:
- Borderline between two scores
- Context-dependent (urban vs. rural, restaurant type)

low:
- Insufficient description
- Ambiguous category definition


========================
INPUT USAGE RULES
========================

Primary signals:
- label_ja (main category name)
- desc_ja (description)
- aliases_top_ja (alternative names)

IMPORTANT:
- item_qid is an identifier ONLY
- Do NOT use item_qid or hidden IDs to infer orderability
- Judge based on human-readable information only


========================
OUTPUT
========================

Return exactly one decision per item,
in the same order as input,
using the provided tool specification.

Do not include explanations outside the required fields.
"""


def build_user_message(items: List[Dict]) -> str:
    """
    user message を構築（料理カードバッチ）
    
    Args:
        items: 料理カードのリスト
        
    Returns:
        JSON文字列
    """
    return json.dumps({"items": items}, ensure_ascii=False, separators=(",", ":"))


def build_tool_spec(n_items: int) -> Dict:
    """
    Tool specification を生成
    
    Args:
        n_items: アイテム数（配列長制約に使用）
        
    Returns:
        OpenAI tool spec 辞書
    """
    return {
        "type": "function",
        "function": {
            "name": "submit_dine_out_orderability_decisions",
            "description": "Submit dine-out orderability scores for Japanese market.",
            "parameters": {
                "type": "object",
                "properties": {
                    "results": {
                        "type": "array",
                        "minItems": n_items,
                        "maxItems": n_items,
                        "items": {
                            "type": "object",
                            "properties": {
                                "item_qid": {"type": "string"},
                                "score": {
                                    "type": "number",
                                    "enum": [0, 0.5, 1]
                                },
                                "confidence": {
                                    "type": "string",
                                    "enum": ["high", "medium", "low"]
                                },
                                "reason": {
                                    "type": "string",
                                    "maxLength": 120
                                }
                            },
                            "required": ["item_qid", "score", "confidence", "reason"],
                            "additionalProperties": False
                        }
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
