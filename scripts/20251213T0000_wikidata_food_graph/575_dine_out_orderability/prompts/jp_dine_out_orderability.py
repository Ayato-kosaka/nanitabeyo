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
users would "go out to eat" as a PRIMARY destination purpose.

========================
WHAT THIS MEASURES (ONLY)
========================

Answer ONLY this question:

"Would users realistically go out specifically to eat/drink this category?"

Interpretation:
- People can say: "今日は◯◯を食べに行こう / ◯◯を飲みに行こう"
- Restaurants/shops commonly treat it as a main attraction (主役カテゴリ)

========================
WHAT THIS DOES NOT MEASURE
========================

IGNORE:
- Popularity / trendiness (market_salience handles this)
- Cultural importance / authenticity
- Wikipedia notability
- Personal preference

========================
SCORES (DISCRETE)
========================

Scores must be one of: 0 / 0.5 / 1

score = 1 (destination-purpose):
- Commonly a primary dish/drink category people go out for.
- Typical "main category" in restaurant search.
- IMPORTANT: "Some specialty shops exist" is NOT sufficient by itself.
  It must be generally plausible as a dining-out purpose.

Examples (1):
ラーメン, 寿司, 焼肉, しゃぶしゃぶ, カレー, うどん, そば,
天ぷら, とんかつ, 餃子, 丼もの, 鍋料理, 定食の主役級

score = 0.5 (menu item but not a destination):
- Appears on restaurant menus, but rarely the sole destination purpose.
- Often a side dish, dessert, drink, topping, small plate, or component.
- Default for most desserts, wagashi, drinks, and side dishes unless clearly destination-level.

Examples (0.5):
味噌汁, 漬物, 枝豆, 茶碗蒸し, 卵焼き, ナムル,
一般的なデザート（ティラミス等）, 一般的な和菓子（葛餅・練り切り等）,
一般的な酒類カテゴリ（ワイン/シードル等の銘柄・種類単体）

score = 0 (not orderable as dine-out purpose):
- Primary channel is retail/home consumption OR not orderable as a restaurant query.
- Ingredients, seasonings, raw materials, packaged foods, RTD, brands.

MUST be 0:
- Brand names (e.g., コカ・コーラ, カルピス, ポッキー)
- Packaged/retail products (e.g., カップ麺, レトルトカレー, 缶コーヒー)
- Ingredients/condiments (e.g., 醤油, 塩, 砂糖, 小麦粉)
- Home-consumption basics (e.g., 食パン, 白米, バター)
- Abstract non-orderable categories (e.g., 調味料, 穀物, 乳製品)

========================
CRITICAL GUARDRAILS (IMPORTANT)
========================

1) Brand / packaged / RTD / retail product -> ALWAYS score = 0

2) If desc_ja mentions brands, product names, "〇〇社", "〇〇製",
   "缶", "ペットボトル", "レトルト", "カップ", "市販" -> score = 0

3) Ingredients / seasonings / raw materials -> score = 0

4) Desserts / wagashi / side dishes / drinks:
   - Default score = 0.5
   - Only score = 1 if it is CLEARLY a common dining-out destination purpose
     in Japan (people commonly go out specifically for it).

5) When in doubt between 0 and 0.5, or 0.5 and 1:
   -> Choose the LOWER score (avoid false positives).

========================
INPUT USAGE RULES
========================

Primary signals:
- label_ja
- desc_ja
- aliases_top_ja

item_qid is an identifier only. Do not infer from IDs.

========================
OUTPUT FORMAT (STRICT)
========================

Return exactly one decision per item using the tool spec.
Do not output any text outside the tool call.

For each item:
- score must be 0, 0.5, or 1
- confidence: high / medium / low
- reason must be ONE of the following TAGS only:

Allowed reason tags:
- restaurant_destination          (typical score 1)
- menu_item_not_destination       (typical score 0.5)
- retail_or_home_primary          (typical score 0)
- brand_or_rtd_packaged           (forced 0)
- ingredient_or_condiment         (forced 0)
- too_abstract_not_orderable      (forced 0)

Confidence guidance:
- high: clear match to rules/examples
- medium: borderline (0 vs 0.5 or 0.5 vs 1)
- low: insufficient/ambiguous description
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
