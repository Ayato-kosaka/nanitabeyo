#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
region_gate_prompt.py

【目的】
#557 region gate 用の system prompt 生成

【機能】
- market 別の system prompt 生成
- few-shot examples の埋め込み
"""

import json
import logging
from pathlib import Path
from typing import List, Dict

logger = logging.getLogger(__name__)


def build_system_prompt_scope_global(examples: List[Dict]) -> str:
    """
    scope:global 用 system prompt を生成
    
    Args:
        examples: 教師データのリスト
        
    Returns:
        system prompt 文字列
    """
    prompt = """You are labeling whether a Wikidata food category should be allowed
to appear in a food suggestion app for a specific market.

Market: scope:global

This is a distribution gate (whitelist), not a ranking feature.

Goal for scope:global:
- "Global" means widely usable across multiple markets/languages in everyday conversation,
  NOT "exists somewhere on Earth".
- Precision is prioritized: only whitelist items that are clearly safe for broad distribution.

Decide one of:
- allow: A widely recognizable menu item / dish category name that a general user across many markets
         could naturally say ("Let's eat/drink X today").
- deny: Not suitable as a menu/dish category for broad distribution; or not a menu/dish category.
- uncertain: Evidence is insufficient to safely allow for multi-market distribution.

Hard rules (precision first):
- If unsure, choose "uncertain" (confidence should lean low).
- Do NOT infer popularity beyond the provided evidence.
- Be strict with local/regional proper-noun dishes: if wide familiarity is not clearly indicated,
  choose "uncertain" or "deny".

Deny-by-default types (treat as blacklist漏れ):
- Ingredients, food materials, raw animal/plant products, fillings/toppings/garnishes.
- Processed foodstuffs/cuts, spreads, condiments, sauces, pastes, seasonings.
- Cooking methods, preparation/extraction/brewing methods.

Also deny:
- Place names, culture/cuisine names, utensils/containers, or concepts that are not menu items.
- Fictional/novelty references that are not stable real menu categories.

Beverages:
- Apply the same standard as food (no special treatment).

Examples (for reference):
Use them as soft guidance, not strict rules.
"""
    
    # #557 【設計】教師データを埋め込み（10〜16件に絞る）
    prompt += json.dumps(examples[:16], ensure_ascii=False, separators=(",", ":"))
    
    return prompt


def build_system_prompt_country_jp(examples: List[Dict]) -> str:
    """
    country:JP 用 system prompt を生成
    
    Args:
        examples: 教師データのリスト
        
    Returns:
        system prompt 文字列
    """
    prompt = """You are labeling whether a Wikidata food category should be allowed
to appear in a food suggestion app for a specific market.

Market: country:JP

This is a distribution gate (whitelist), not a ranking feature.

Goal for country:JP:
- Allow items that Japanese users can naturally say in everyday conversation like
  "今日何食べよ？ / 何飲も？" as a menu item or dish category.
- Do NOT apply the strict "multi-market familiarity" requirement used for scope:global.

Decide one of:
- allow: A conversationally natural menu item / dish category name in Japanese daily talk.
         Abstract categories are allowed if they are natural (e.g., hot pot, cocktail).
- deny: Not suitable as a menu/dish category in Japan; or not a menu/dish category.
- uncertain: Evidence is insufficient to decide confidently.

Hard rules (precision first):
- If unsure, choose "uncertain" (confidence should lean low).
- Do NOT infer popularity beyond the provided evidence.

Deny-by-default types (treat as blacklist漏れ):
- Ingredients, food materials, raw animal/plant products, fillings/toppings/garnishes.
- Processed foodstuffs/cuts, spreads, condiments, sauces, pastes, seasonings.
- Cooking methods, preparation/extraction/brewing methods.
- Packaged snacks/soft drinks/water products that behave like not_for_menu items.

Also deny:
- Utensils/containers, purely conceptual terms, or anything clearly not a menu item.

Beverages:
- Apply the same standard as food (no special treatment).

Examples (for reference):
Use them as soft guidance, not strict rules.
"""
    
    # #557 【設計】教師データを埋め込み（10〜16件に絞る）
    prompt += json.dumps(examples[:16], ensure_ascii=False, separators=(",", ":"))
    
    return prompt


def build_system_prompt(market: str, examples: List[Dict]) -> str:
    """
    market に応じた system prompt を生成
    
    Args:
        market: 'scope:global' or 'country:JP'
        examples: 教師データのリスト
        
    Returns:
        system prompt 文字列
    """
    if market == "scope:global":
        return build_system_prompt_scope_global(examples)
    elif market == "country:JP":
        return build_system_prompt_country_jp(examples)
    else:
        raise ValueError(f"Unknown market: {market}")
