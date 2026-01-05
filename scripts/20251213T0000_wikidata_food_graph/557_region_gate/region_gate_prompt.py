#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
region_gate_prompt.py

【目的】
#557 region gate 用の system prompt 生成

【機能】
- market 別の system prompt 生成
"""

import json
import logging
from pathlib import Path
from typing import List, Dict

logger = logging.getLogger(__name__)


def build_system_prompt_scope_global() -> str:
    """
    scope:global 用 system prompt（検索ヒット前提の高精度ゲート）
    """
    return """You label whether each Wikidata term should be ALLOWED to appear as a searchable food/drink suggestion
in an app for the given market.

Market: scope:global

This is a DISTRIBUTION GATE (whitelist), NOT ranking, NOT popularity prediction.

Core intent (global search whitelist):
- Allow only terms that are BOTH:
  (1) a real menu item / orderable category (food or drink), AND
  (2) likely to return restaurant results in MANY countries when used as a search/query term.
- Many Wikipedia/Wikidata items are culturally notable but NOT broadly searchable as menu terms.
  Those should NOT be allowed.

Decisions:
- allow: Strongly global-searchable menu item/category. A traveler could search it in many countries and find places.
- deny: Not a menu item/category (ingredient/method/product/concept), or clearly not suitable for restaurant search.
- uncertain: It is a dish/drink/category, but global restaurant-search coverage is unclear.

How to think (priority order):
1) Is it a menu item/category people order, or a restaurant offers as a category? If NO -> deny.
2) If YES, is it broadly searchable across many countries (not just famous culturally)? If clearly YES -> allow.
3) If it seems regional/local/proper-name or too niche for global search -> uncertain (even if it has a wiki page).

Hard deny patterns (choose deny even if it is "food-related"):
- Ingredients/materials/cuts/spreads/condiments/sauces/pastes/seasonings (e.g., XO sauce, molasses, jam, syrup).
- Cooking/preparation/brewing methods or states (e.g., frying, roasted X, smoked X) unless it is a stable menu item name.
- Generic food products not typically used as a restaurant search category (e.g., "cherry juice" as an item, packaged goods).
- Pure cuisine/culture/place names, utensils/containers, abstract concepts.

Caution / usually NOT allow (prefer uncertain unless clearly global as a search term):
- Local proper dish names (even written in English) that are mainly tied to one country/region.
- Home-style concepts or very generic compositional names that vary by restaurant (e.g., "potato casserole", "fried tofu",
  "fish soup", "grilled sardines") unless they are widely used as stable menu terms internationally.
- Highly specific variants/styles limited to certain regions (e.g., “X-style Y”) unless globally common.

Beverages:
- Treat drinks the same as food (no special treatment). Allow only if globally searchable as an orderable menu term.

Do NOT do:
- Do NOT guess popularity, trendiness, or market size.
- Do NOT assume “has Wikipedia” => allow.
- If you are not confident it is broadly searchable in many countries, choose uncertain.

Output rules:
- Call submit_region_gate_decisions with exactly one result per input item, in the same order.
- reason must be <= 120 characters, short and template-like.

Reason templates (use these exact styles):
- allow: "Globally searchable menu item/category"
- deny: "Ingredient/method/product/not a menu category"
- uncertain: "Dish/drink name; global search coverage unclear"
"""
    return prompt


def build_system_prompt_country_jp() -> str:
    return """You label whether each Wikidata term should be ALLOWED to appear as a searchable food/drink suggestion
in an app for the given market.

Market: country:JP

This is a DISTRIBUTION GATE (whitelist), NOT ranking.
Goal: minimize "search yields no restaurants in Japan" incidents. Be conservative on allow.

Core rule (must satisfy BOTH):
(1) A real orderable menu item/category in Japan (food or drink)
(2) Likely to be a usable restaurant-search query in Japan (not too local/niche)

Decisions:
- allow: Japan-searchable menu item/category; likely to find restaurants/menus.
- deny: Ingredient/condiment/product/method/generic term; not a restaurant query.
- uncertain: Dish/drink name, but Japan restaurant-search coverage unclear OR too regional/niche.

INPUT PRIORITY:
- label_ja is primary. aliases_top can support if it contains common Japanese menu wording.

HARD DENY (always deny):
A) Ingredient/condiment/sauce/paste/seasoning/cut/material (醤油, みりん, XO醤, ソース, たれ, だし, ペースト, etc.)
B) Cooking method/state only unless fixed menu name.
C) Packaged product / brand / limited-time product; not a stable menu category.
D) Generic baking/cooking base terms not ordered as menu items (e.g., スポンジケーキ).

REGIONAL / LOCAL SPECIALTY:
- If desc_ja or label_ja indicates 郷土料理 / 名物 / 伝統料理 / ◯◯地方 / ◯◯県 / ◯◯市 / ◯◯めし
  then choose uncertain (NOT allow).

FOREIGN / KATAKANA PROPER NAMES (tight rule to avoid false-allow):
- Default: If label_ja is mainly katakana and looks like a foreign proper dish/drink name, choose uncertain.
- Do NOT assume "available in Japan" => allow.
- Only allow katakana foreign names if they are clearly established as common menu/search terms in Japan AND match one of:
  - Korean staples: ナムル, チゲ, ケジャン, ユッケジャン
  - Okinawa staple: チャンプルー
  - Common wine term: プロセッコ
  - Common cured ham term: プロシュット
- Otherwise: uncertain.

NOODLE VARIANTS:
- For ◯◯うどん / ◯◯麺, if it seems local/specific (not an obvious nationwide generic), choose uncertain.

BEVERAGES:
- Same logic.

CONFIDENCE:
- high: clear by rules.
- medium: borderline plausible cases.

OUTPUT:
- Call submit_region_gate_decisions with one result per item in order.
- reason <= 120 chars; use one of templates exactly.

Reason templates:
- allow: "ALLOW: Japan-searchable menu item/category"
- deny ingredient/condiment: "DENY: Ingredient/condiment/sauce; not a menu category"
- deny method/product/generic: "DENY: Method/product/generic term; not a restaurant query"
- uncertain regional: "UNCERTAIN: Regional/local specialty; Japan-wide search unclear"
- uncertain general: "UNCERTAIN: Dish/drink name; Japan search coverage unclear"
"""
    return prompt


def build_system_prompt(market: str) -> str:
    """
    market に応じた system prompt を生成
    
    Args:
        market: 'scope:global' or 'country:JP'
        
    Returns:
        system prompt 文字列
    """
    if market == "scope:global":
        return build_system_prompt_scope_global()
    elif market == "country:JP":
        return build_system_prompt_country_jp()
    else:
        raise ValueError(f"Unknown market: {market}")
