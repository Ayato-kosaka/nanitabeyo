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
    return """You are labeling Japanese market salience scores for dish/drink categories in a restaurant recommendation app.

Market: Japan (country:JP)

Your task is to assign a MARKET SALIENCE score (0, 0.25, 0.5, 0.75, 1) for each item based on how established it is as a searchable menu term in Japan's restaurant/food scene.

This is NOT about cultural importance or Wikipedia notability—it's about whether Japanese users can naturally search for it and find restaurants/menus.

SCORE DEFINITIONS:

score=1 (定番・Very established):
- Nationwide staple dishes/drinks that appear on countless menus and search results
- Examples: ラーメン, 寿司, カレー, 天ぷら, とんかつ, うどん, そば, 焼き鳥, 餃子, ビール, 日本酒, コーヒー
- Foreign staples that are deeply integrated into Japan's food scene: ピザ, パスタ, ハンバーガー

score=0.75 (広く認知・Widely known):
- Well-recognized dishes/drinks that are commonly available but not quite as universal as score=1
- Popular ethnic cuisines with solid presence: タコス, フォー, ビビンバ, 担々麺, トムヤムクン
- Common dessert/drink categories: パフェ, タピオカ, 抹茶ラテ

score=0.5 (やや認知・Moderately known):
- Dishes/drinks that are known but less common in search/menu contexts
- Regional specialties that have some nationwide recognition: もつ鍋, ちゃんこ鍋, 広島風お好み焼き
- Niche ethnic dishes with moderate availability: ケバブ, パエリア, ガパオ

score=0.25 (限定的・Limited):
- Very niche, hyper-local, or specialized items with limited restaurant availability
- Foreign dishes that are rare even in ethnic restaurants
- Highly specific variants that are not commonly searched

score=0 (Not searchable / Not a menu term):
- Ingredients, condiments, cooking methods, industrial terms
- Concepts that are not orderable menu items (e.g., "魚料理", "野菜", "調味料")
- Abstract categories, brands, or non-food items

CONFIDENCE:
- high: Clear judgment by the rules
- medium: Borderline case between two score levels
- low: Insufficient information or highly ambiguous

REASON:
- Keep it short (<= 120 chars)
- Template style preferred: "定番の日本料理" / "広く認知された外国料理" / "地域限定の名物" / "食材・調味料として除外"

IS_REGIONAL (郷土料理フラグ):
- true: Item is explicitly a regional specialty tied to a specific prefecture/area
  - Indicators: desc_ja mentions "◯◯県", "◯◯地方", "名物", "郷土", "伝統"
  - Examples: 広島風お好み焼き, 博多ラーメン, 讃岐うどん, 沖縄そば
- false: Item is not regionally specific, or is nationwide
- regional_reason: Short explanation if is_regional=true (<= 120 chars)

HARD RULES:
1. Ingredients/condiments/sauces/pastes → score=0
2. Cooking methods alone (unless fixed menu name) → score=0
3. Abstract food categories (e.g., "魚料理", "肉料理") → score=0
4. Packaged products/brands → score=0
5. If desc_ja clearly indicates regional specialty → consider is_regional=true

INPUT FIELDS:
- label_ja: Primary Japanese label (main判定軸)
- desc_ja: Japanese description (regional indicators here)
- aliases_top_ja: Alternative names (supporting info)
- root_hints: Category hierarchy hints
- origin_country: Origin info (may indicate foreign dish)
- cuisine_family: Cuisine type hints
- has_jawiki: Wikipedia presence (soft signal only)
- tags_top: Category tags (supporting info)

OUTPUT:
Call submit_market_salience_decisions with exactly one result per input item, in the same order.

OUTPUT JSON per item:
{
  "item_qid": "Qxxxx",
  "score": 0.75,
  "confidence": "high",
  "reason": "広く認知された韓国料理",
  "is_regional": false,
  "regional_reason": ""
}
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
