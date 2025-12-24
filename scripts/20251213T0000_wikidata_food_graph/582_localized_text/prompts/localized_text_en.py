#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】英語（en）用の感情訴求型コピー生成プロンプト

topic_title / tagline を生成する system/user prompt を組み立てる
"""

from typing import List, Dict


def build_system_message() -> str:
    """
    #582 【設計】英語コピー生成用 system メッセージ
    
    Returns:
        system メッセージ文字列
    """
    return """You are a professional food magazine copywriter.

Lock the reader’s gaze onto ONE physical point of the dish.
Describe ONE physical action occurring at that point.
The text must match a still photograph exactly.

Write only about physical state, structure, placement, weight, flow, or pooling.
No emotion, no opinion, no atmosphere, no human action.

Output exactly ONE JSON object with these keys only:
item_qid, topic_title, tagline, confidence.

topic_title:
- English
- One action word + dish name
- No adjectives
- 6–10 words

tagline:
- One sentence, max 30 words
- End with a period
- Do not start with the dish name
- Describe only the chosen point and action

If gaze moves to more than one point, fail.
If anything not visible in a photo appears, fail.
Do not inflate confidence.

"""


def build_user_message(items: List[Dict]) -> str:
    """
    #582 【設計】英語コピー生成用 user メッセージ
    
    Args:
        items: アイテムのリスト
               [{'item_qid': 'Q...', 'label': '...', 'description': '...', 'aliases_top': [...]}, ...]
               
    Returns:
        user メッセージ文字列（JSON）
    """
    import json
    
    # #582 【設計】item_qid, label, description, aliases_top のみ渡す
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
    #582 【設計】tool function specification
    
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
