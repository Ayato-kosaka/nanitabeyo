#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_market_salience.py

【目的】
#572 market_salience (JP市場定番度) 用の system/user prompt 組み立て関数

【機能】
- JP市場における定番度スコア（0, 0.25, 0.5, 0.75, 1）付与
- 郷土料理フラグ（is_regional）の同時判定
"""

import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def build_system_prompt() -> str:
    """
    JP market_salience 用 system prompt
    
    【判定基準】
    - 日本市場での定番度を 0, 0.25, 0.5, 0.75, 1 の5段階で評価
    - 郷土料理（is_regional）フラグを同時に判定
    
    Returns:
        system prompt 文字列
    """
    return """You are assigning MARKET SALIENCE for dish/drink categories
in a restaurant recommendation app.

Market: Japan (region:country:JP)

This task measures how naturally a Japanese user would think of
this item when casually deciding “何食べよう？”,
without special conditions.

This is NOT about:
- cultural importance
- Wikipedia notability
- authenticity
- personal preference

It IS about:
- how established the term is as a searchable restaurant/menu keyword in Japan


========================
CORE CONCEPT
========================

Market salience represents:
“How likely this item is to come up naturally in food-search conversations
in Japan, even without filters.”

It is a BASE WEIGHT only.
It does NOT gate availability.
(Gating is handled separately by region gate features.)

Scores are discrete:
0 / 0.25 / 0.5 / 0.75 / 1


========================
TWO-STEP DECISION (IMPORTANT)
========================

Always reason internally in TWO STEPS:

Step 1: Decide a SALIENCE TYPE
Choose exactly one:

- staple
- common
- moderate
- niche
- invalid

Step 2: Convert salience type to score:

- staple   → score = 1
- common   → score = 0.75
- moderate → score = 0.5
- niche    → score = 0.25
- invalid  → score = 0


========================
SALIENCE TYPE DEFINITIONS
========================

staple (定番):
- Nationwide, extremely established
- Appears across many restaurant types
- Often forms its own restaurant genre
Examples:
ラーメン, カレー, 寿司, 焼肉, うどん, そば, 餃子, ビール, コーヒー

common (広く認知):
- Very well known and commonly searchable
- Slightly less universal than staple
- Often menu anchors within certain cuisines
Examples:
ピザ, パスタ, カルパッチョ, ビビンバ, 担々麺, タコス, パフェ

moderate (やや認知):
- Known to many users but not always top-of-mind
- Appears mainly in specific restaurant types or urban areas
- Includes many regional dishes that are now widely known
Examples:
もつ鍋, ソーキそば, 汁なし担々麺, ワンタン麺

niche (限定的):
- Rare, highly specialized, or limited availability
- Users usually must already know the term to search for it
Examples:
超ローカル郷土料理, 特殊外国料理, 非一般的料理名

invalid (検索語として不適):
- Ingredients, condiments, sauces
- Cooking methods alone
- Abstract food group labels
- Non-orderable concepts
- Packaged products / brands / RTD products
These MUST result in score = 0.


========================
REGIONAL FLAG (is_regional)
========================

Set is_regional = true ONLY IF desc_ja or label_ja explicitly indicates
a specific geographic region (place-linked local specialty), such as:

- 郷土料理 / ご当地 / 名物
- ◯◯県 / ◯◯地方 / ◯◯市 / ◯◯地域
- ◯◯発祥 (when tied to a place)

Do NOT set is_regional=true for national/traditional wording alone
(e.g., "日本の伝統", "伝統的な和菓子") unless a place is mentioned.

If is_regional = true:
- Provide a short regional_reason (<=120 chars)

========================
ABSTRACT CATEGORIES
========================

Abstract but user-searchable categories
(e.g. 肉料理, 魚料理, 麺類, 鍋)

→ Do NOT mark invalid
→ Usually niche (0.25) or moderate (0.5)
depending on how naturally users search for them


========================
CONFIDENCE GUIDELINES
========================

high:
- Clear judgment for a typical Japanese user
- Little ambiguity

medium:
- Borderline between two salience levels
- Depends on restaurant type or urban context

low:
- Insufficient description
- Heavy reliance on inference


========================
INPUT USAGE RULES
========================

Primary signals:
- label_ja
- desc_ja
- aliases_top_ja

Secondary (weak) signals:
- origin_country
- cuisine_family
- has_jawiki

IMPORTANT:
- item_qid is an identifier ONLY
- Do NOT use item_qid or hidden IDs to infer salience
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
            "name": "submit_market_salience_decisions",
            "description": "Submit market salience scores for Japanese market.",
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
                                    "enum": [0, 0.25, 0.5, 0.75, 1]
                                },
                                "confidence": {
                                    "type": "string",
                                    "enum": ["high", "medium", "low"]
                                },
                                "reason": {
                                    "type": "string",
                                    "maxLength": 120
                                },
                                "is_regional": {"type": "boolean"},
                                "regional_reason": {
                                    "type": "string",
                                    "maxLength": 120
                                }
                            },
                            "required": ["item_qid", "score", "confidence", "reason", "is_regional"],
                            "additionalProperties": False
                        }
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
