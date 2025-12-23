#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_relevance_scoring_phase2.py

【目的】
#581 relevance_scoring Phase2（レビュー）用の system/user prompt 組み立て関数

【機能】
- Phase1 の結果をレビューし、accept / edit / deny を判定
- edit は隣接スコア修正（0↔0.5↔1）のみ
- rubric 適用チェック専用（新しい判断軸は作らない）
"""

import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def build_system_prompt() -> str:
    """
    JP relevance_scoring Phase2 用 system prompt
    
    【判定基準】
    - Phase1 のスコアが rubric に従っているかチェック
    - accept / edit / deny を判定
    - edit は隣接スコア修正のみ
    
    Returns:
        system prompt 文字列
    """
    return """You are REVIEWING relevance feature scores assigned in Phase 1
for dish/drink categories in a restaurant recommendation app.

Market: Japan (外食市場)

Your role is to verify that Phase 1 scores follow the rubric correctly.
You are NOT creating new scoring rules or judgment axes.

========================
YOUR TASK (ONLY)
========================

For each feature score from Phase 1, decide:

1) accept - Score follows rubric correctly
2) edit - Score deviates from rubric, needs adjustment
3) deny - Score is completely wrong or unparseable

========================
EDIT RULES (STRICT)
========================

When editing, you can ONLY make adjacent score adjustments:
- 0 ↔ 0.5
- 0.5 ↔ 1
- 0 → 1 is NOT allowed (too large a jump)
- 1 → 0 is NOT allowed (too large a jump)

Examples of valid edits:
- 0 → 0.5 (was too harsh)
- 0.5 → 0 (was too generous)
- 0.5 → 1 (slightly underrated)
- 1 → 0.5 (slightly overrated)

Examples of INVALID edits:
- 0 → 1 (use deny instead)
- 1 → 0 (use deny instead)

========================
REVIEW CRITERIA
========================

Check Phase 1 scores against the rubric definitions:

A) timeSlot (morning / lunch / afternoon / dinner / late_night)
B) scene (solo / date / friends / family / drinking)
C) appetite (hearty / normal / light)
D) taste (sweet / spicy / healthy / junk / alcohol)

Refer to the Phase 1 rubric (same definitions).

========================
COMMON ERRORS TO CATCH
========================

1) Popularity bias:
   - Phase 1 scored based on popularity instead of contextual fit
   - Example: 0 for unpopular but contextually natural items

2) Over-precision:
   - Should be 0.5 (borderline) but Phase 1 used 0 or 1
   - Reminder: When in doubt, Phase 1 should use 0.5

3) Incorrect rubric application:
   - Clearly violates rubric definition
   - Example: score=1 for "dinner" on a dessert-only item

4) Consistency issues:
   - Contradictory scores across features
   - Example: score=0 for "dinner" but score=1 for "family"
     (most family dining happens at dinner)

========================
DENY USAGE
========================

Use deny when:
- Phase 1 score is 0 or 1, but should be 1 or 0 respectively
- Completely wrong feature assignment
- Unparseable or nonsensical reasoning

After deny, Phase 1 score will NOT be published.

========================
ACCEPT USAGE
========================

Use accept when:
- Phase 1 score follows rubric correctly
- Small imperfections are acceptable (rubric allows 0.5 for borderline)
- Reasoning is sound

========================
GUARDRAILS (CRITICAL)
========================

1) Do NOT introduce new scoring rules or criteria
2) Do NOT re-evaluate based on your own judgment
3) ONLY check consistency with Phase 1 rubric
4) When borderline -> accept (Phase 1 is allowed to use 0.5)
5) Edit ONLY for adjacent score adjustments
6) Deny ONLY for large errors (0↔1 jumps)

========================
INPUT FORMAT
========================

You will receive:
- item_qid
- label_ja, desc_ja, aliases_top_ja
- Phase 1 scores with feature_type, feature_key, score, confidence, reason

========================
OUTPUT FORMAT (STRICT)
========================

For each Phase 1 feature score, return ONE of:

action: "accept"
- No changes needed

action: "edit"
- new_score: adjusted score (must be adjacent to original)
- new_confidence: high / medium / low
- new_reason: short explanation (max 120 chars, Japanese OK)

action: "deny"
- reason: why this score is completely wrong (max 120 chars)

Return structured results using the tool spec.
"""


def build_user_message(items_with_phase1: List[Dict]) -> str:
    """
    user message を構築（Phase1 結果付き料理カード）
    
    Args:
        items_with_phase1: Phase1 結果を含む料理カードのリスト
        
    Returns:
        JSON文字列
    """
    return json.dumps({"items": items_with_phase1}, ensure_ascii=False, separators=(",", ":"))


def build_tool_spec(n_items: int, n_features_per_item: int) -> Dict:
    """
    Tool specification を生成
    
    Args:
        n_items: アイテム数
        n_features_per_item: 1アイテムあたりの feature 数
        
    Returns:
        OpenAI tool spec 辞書
    """
    return {
        "type": "function",
        "function": {
            "name": "submit_review_decisions",
            "description": "Submit review decisions for Phase 1 relevance feature scores.",
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
                                "reviews": {
                                    "type": "array",
                                    "minItems": n_features_per_item,
                                    "maxItems": n_features_per_item,
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "feature_type": {
                                                "type": "string",
                                                "enum": ["timeSlot", "scene", "appetite", "taste"]
                                            },
                                            "feature_key": {
                                                "type": "string"
                                            },
                                            "action": {
                                                "type": "string",
                                                "enum": ["accept", "edit", "deny"]
                                            },
                                            "new_score": {
                                                "type": "number",
                                                "enum": [0, 0.5, 1]
                                            },
                                            "new_confidence": {
                                                "type": "string",
                                                "enum": ["high", "medium", "low"]
                                            },
                                            "new_reason": {
                                                "type": "string",
                                                "maxLength": 120
                                            }
                                        },
                                        "required": ["feature_type", "feature_key", "action"],
                                        "additionalProperties": False
                                    }
                                }
                            },
                            "required": ["item_qid", "reviews"],
                            "additionalProperties": False
                        }
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
