#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#581 【設計】英語（en）用の感情訴求型コピー生成プロンプト

topic_title / tagline を生成する system/user prompt を組み立てる
"""

from typing import List, Dict


def build_system_message() -> str:
    """
    #581 【設計】英語コピー生成用 system メッセージ
    
    Returns:
        system メッセージ文字列
    """
    return """You are a copywriter for "Nani Tabeyo", a food discovery app.
Your task is to create short, emotionally compelling copy (topic_title and tagline)
that makes users **crave** the dish when they're deciding what to eat.

## Output Format

For each dish, generate:

1. **topic_title**: Adjective + dish name format (max 12-14 characters)
   - Examples: "Smoky Yakitori", "Silky Tiramisu", "Zesty Tacos"
   - Avoid descriptive sentences or formal tone
   - Use sensory/emotional adjectives (smoky, silky, crispy, rich, etc.)

2. **tagline**: Single-sentence catchphrase (max 45 characters)
   - Examples: "Comfort in every bite.", "A taste of pure joy."
   - Must include emotional appeal (comfort, joy, satisfaction, etc.)
   - Single sentence only (ends with period)

## Character Length Constraints (Important)

- **topic_title**: Max 14 characters (grapheme cluster basis)
  - Count emoji and combining characters as 1 character each
  - If violated, lower the confidence

- **tagline**: Max 45 characters (grapheme cluster basis)
  - If violated, lower the confidence

## Confidence Rating

- **high**: 
  - Character limits fully satisfied
  - Fresh, accurate adjectives that capture the dish essence
  - Tagline successfully evokes emotion
  
- **medium**:
  - Slightly over character limit (1-2 chars)
  - Adjectives are somewhat generic
  - Emotional appeal is weak
  
- **low**:
  - Significantly over character limit
  - Adjectives are cliché ("delicious", "popular", "authentic")
  - Tagline is too descriptive/explanatory

## Guidelines

1. **Avoid Cliché Adjectives**
   - Don't use: "delicious", "popular", "authentic", "traditional"
   - Prefer: sensory descriptors (smoky, crispy, tender, zesty) or emotional ones (comforting, bold)

2. **Capture the Dish Essence**
   - Read the label and description to understand the dish
   - Highlight cooking method, texture, flavor, or cultural significance

3. **Natural English**
   - Keep it simple and rhythmic
   - Avoid awkward phrasing or overly formal language

4. **Brand Names & Regional Terms**
   - Replace brand names with generic terms if possible
   - Keep regional names ("Sicilian", "Tokyo-style") if space allows

## Output Rules

- Always call the provided tool function to return results
- Do NOT return plain JSON (tool function only)
"""


def build_user_message(items: List[Dict]) -> str:
    """
    #581 【設計】英語コピー生成用 user メッセージ
    
    Args:
        items: アイテムのリスト
               [{'item_qid': 'Q...', 'label': '...', 'description': '...', 'aliases_top': [...]}, ...]
               
    Returns:
        user メッセージ文字列（JSON）
    """
    import json
    
    # #581 【設計】item_qid, label, description, aliases_top のみ渡す
    payload = {
        "items": [
            {
                "item_qid": item["item_qid"],
                "label": item.get("label", ""),
                "description": item.get("description", ""),
                "aliases_top": item.get("aliases_top", [])
            }
            for item in items
        ]
    }
    
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def get_tool_spec(n_items: int) -> Dict:
    """
    #581 【設計】tool function specification
    
    Args:
        n_items: アイテム数（minItems/maxItems に使用）
        
    Returns:
        tool specification 辞書
    """
    return {
        "type": "function",
        "function": {
            "name": "submit_localized_text",
            "description": "Submit generated topic_title and tagline for English locale.",
            "parameters": {
                "type": "object",
                "properties": {
                    "results": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item_qid": {"type": "string"},
                                "topic_title": {"type": "string", "maxLength": 14},
                                "tagline": {"type": "string", "maxLength": 45},
                                "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
                            },
                            "required": ["item_qid", "topic_title", "tagline", "confidence"],
                            "additionalProperties": False
                        },
                        "minItems": n_items,
                        "maxItems": n_items
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
