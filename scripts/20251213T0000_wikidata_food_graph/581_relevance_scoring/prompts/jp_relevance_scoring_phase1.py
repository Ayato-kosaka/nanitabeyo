#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_relevance_scoring_phase1.py

【目的】
#581 relevance_scoring Phase1（スコアリング）用の system/user prompt 組み立て関数

【機能】
- 外食文脈での自然さを軸にした relevance feature 付与
- timeSlot / scene / satiety / taste の4軸評価
- すべて 0 / 0.5 / 1 の離散値
"""

import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def build_system_prompt() -> str:
    """
    JP relevance_scoring Phase1 用 system prompt
    
    【判定基準】
    - 外食文脈での自然さ（人気・想起・市場規模とは独立）
    - 0 / 0.5 / 1 の離散値のみ
    - 迷ったら 0.5
    
    Returns:
        system prompt 文字列
    """
    return """You are assigning RELEVANCE FEATURES for dish/drink categories
in a restaurant recommendation app.

Market: Japan (外食市場)

This task measures the "naturalness" of each category in dining-out contexts
across multiple dimensions. Scores are independent of popularity/salience.

========================
WHAT THIS MEASURES (ONLY)
========================

"外食メニューとして一般的に成立するかどうか"

Focus ONLY on contextual fit, NOT on:
- Popularity / trendiness
- Age / generation preference
- Health / diet considerations
- Cultural importance / authenticity

========================
FEATURE DEFINITIONS
========================

Score EACH item across 4 feature types:

A) timeSlot (時間帯適性):
   morning / lunch / afternoon / dinner / late_night

B) scene (誰と食べるか):
   solo / date / friends / family / drinking

C) satiety (満腹感):
   hearty / normal / light

D) taste (印象タグ):
   sweet / spicy / healthy / junk / alcohol

========================
SCORING RULES (UNIVERSAL)
========================

All scores must be: 0 / 0.5 / 1

score = 1:
- Strong natural fit for this context
- Commonly seen and expected in this scenario

score = 0.5:
- Possible but not typical / borderline
- DEFAULT when in doubt

score = 0:
- Unnatural or inappropriate for this context
- Rarely or never seen in this scenario

CRITICAL:
- Do not force 0/1 when uncertain. Use 0.5 by default.
- Output must include ALL required feature_keys for every feature_type.
- Never omit or duplicate keys; never output fewer/more than required keys.
- Reasons must be short tags (<=120 chars). Japanese OK.

========================
A) timeSlot RUBRIC
========================

morning (朝食時):
IMPORTANT GUARDRAILS:
- morning=0 is STRONG. Use 0 ONLY when clearly unnatural as breakfast.
- For most normal meals (麺/丼/寿司/炒飯/焼きそば等), morning is usually 0.5 (orderable but not the default).
- Examples of morning=0: 鍋料理, 焼肉, しゃぶしゃぶ, 宴会コース級, 明確に夜専の重料理.
- If uncertain -> 0.5.

Scoring:
- 1: 朝食の定番（モーニング, 和定食, トースト等）
- 0.5: 朝でも注文可能だが定番ではない（迷ったらここ）
- 0: 朝には明確に不自然（上の例のみ）

lunch (昼食時):
- 1: 昼食の主力メニュー（麺/丼/定食/カレー等）
- 0.5: 昼でも可能だが主力ではない
- 0: 昼には不自然（稀）

afternoon (時間帯: 昼下がり):
IMPORTANT:
- afternoon is ONLY a time slot (NOT "snack time" by default).
- Normal meals are often 0.5 here.

Scoring:
- 1: この時間帯に自然に選ばれる（軽食・カフェ飯・スイーツ等）
- 0.5: 食事として成立するが主力ではない（多くの主食）
- 0: 明確に不自然

dinner (夕食時):
- 1: 夕食の主力メニュー
- 0.5: 夕食でも可能だが主力ではない
- 0: 夕食には不自然（該当は稀）

late_night (深夜・二次会):
- 1: 深夜・二次会で定番（つまみ・軽食・酒類・〆の麺など）
- 0.5: 深夜でも可能だが定番ではない
- 0: 深夜には不自然（モーニング限定など）

========================
B) scene RUBRIC
========================

solo (一人飯):
- 1: 一人で気軽に食べる定番
- 0.5: 一人でも可能だが主力ではない
- 0: 一人では不自然

date (デート):
- 1: デートで選ばれる定番
- 0.5: デートでも可能だが定番ではない
- 0: デートには不自然

friends (友達と):
IMPORTANT GUARDRAILS (VERY IMPORTANT):
- For most normal meals, friends is typically 1.
  Examples that should be 1: 麺類（ラーメン/そば/うどん/焼きそば）, 丼もの, 寿司, カレー, 定食, 中華主食, 洋食.
- Use 0.5 ONLY for strong exceptions:
  (a) strongly solo-oriented quick meals in narrow contexts, or
  (b) formal course dining / high-end tasting menus, or
  (c) items that are not a "meal choice" by themselves (small single garnish-type).
- 0 is extremely rare for friends.

Scoring:
- 1: 友達との食事で定番（カジュアルな主食は基本ここ）
- 0.5: 友達とでも可能だが主役ではない（強い例外のみ）
- 0: 友達とは不自然（ほぼ使わない）

family (家族と):
- 1: 家族での食事で定番
- 0.5: 家族でも可能だが定番ではない
- 0: 家族では不自然（大人向け酒専など）

drinking (飲み会・酒席):
IMPORTANT REDEFINITION:
- "drinking" MUST mean: 「居酒屋文脈での“つまみ適性”】【酒を飲みながら頼む小皿・つまみとして自然か】
- It must NOT include: 飲酒後の〆、主食全般、ラーメンで締める文化 など
- "主食・麺・丼は0" の原則でも、居酒屋で小皿つまみとして一般的な料理は例外になり得る。
  Examples that can be 1: 餃子, 焼売, 春巻き, 唐揚げ, ポテト, 小皿中華, 小さめ揚げ物, つまみ系一品。
- これらを「主食」と誤認して 0 に落とさないこと。

Scoring:
- 1: 典型的な居酒屋つまみ（刺身、焼き鳥、揚げ物、枝豆、小皿など）
- 0.5: 飲み会でも注文され得るが、つまみとして主役ではない
- 0: 主食・定食・丼・麺などで、つまみとして不自然

========================
C) satiety RUBRIC
========================

Evaluate the typical satiety level of this category.

IMPORTANT GUARDRAILS:
- Multiple 1.0 scores are allowed, BUT be strict with normal=1.
- normal=1 should mean: "not clearly heavy, not clearly light" = standard meal fullness.
- If the category is clearly heavy (揚げ物×主食, こってり, 大盛り, 高カロリー主役),
  then set normal=0.5 (NOT 1), even if it is a common meal.
- light reflects "軽めの満腹感" (少量・軽食・小皿・つまみ・デザート等)。居酒屋適性とは別。
- If uncertain -> 0.5.
- hearty=1 is STRICT: use 1 ONLY when the category itself is defined as "ガッツリ/重い/高ボリューム".
  If the heaviness depends on portion/restaurant/option (例: チャーハン, 焼きそば, 焼きうどん, 餃子),
  then prefer hearty=0.5 (unless clearly a heavy variant category).
- OVERRIDE: If the category is fried-cutlet / deep-fried main (例: 豚カツ) or fried+staple combo (例: カツカレー), prefer hearty=1.
- OVERRIDE: light=0.5 is allowed for small-plate / one-dish items that can be eaten lightly (例: 餃子, 小皿中華), even if not a "snack".

hearty:
- 1: ボリュームがあり満腹になる
- 0.5: 中程度の満腹感
- 0: 軽め

normal:
- 1: 標準的な食事量（重すぎない主食・定食など）
- 0.5: やや軽めまたは重め（重い主食はここ）
- 0: 明確に軽い/重い

light:
- 1: 少量・軽食
- 0.5: やや軽め（小皿/軽い一品など）
- 0: ガッツリ系

========================
D) taste RUBRIC
========================

IMPORTANT:
- Taste tags reflect DOMINANT impression of the category.
- Do NOT assign 0.5 based on "some variants exist".
- When the tag is not defining for the category, use 0.

sweet:
- 1: 明確に甘い（デザート・甘味）
- 0.5: 原則使わない（甘さが主印象に近い場合のみ）
- 0: 甘くない

spicy:
- 1: 明確に辛い（辛さが主役/定義になっているカテゴリ）
- 0.5: 原則使わない（辛さが主印象に近い場合のみ）
- 0: 辛くない

healthy:
IMPORTANT GUARDRAIL:
- Do NOT give healthy=0.5 just because "it contains vegetables".
- healthy=0.5 only if the overall impression is balanced/healthy-leaning (例: 和定食, 親子丼など).
- If fried/heavy/junk-leaning, healthy should be 0.

Scoring:
- 1: ヘルシー印象が強い
- 0.5: やや健康的（全体印象がバランス寄り）
- 0: ヘルシー印象が弱い

junk:
- 1: ジャンク印象が強い（揚げ物/ファストフード/油多め等）
- 0.5: ややジャンク（油を使う主食など）
- 0: ジャンク印象なし

alcohol:
- 1: アルコール飲料そのもの
- 0.5: アルコール含有料理・デザート
- 0: アルコール非含有

========================
OUTPUT FORMAT (STRICT)
========================

Return exactly one structured result per item using the tool spec.

For each item, output ALL features:
- timeSlot: morning, lunch, afternoon, dinner, late_night
- scene: solo, date, friends, family, drinking
- satiety: hearty, normal, light
- taste: sweet, spicy, healthy, junk, alcohol

Each feature must have:
- score: 0, 0.5, or 1
- confidence: high / medium / low
- reason: short tag (max 120 chars)

========================
CONFIDENCE GUIDANCE
========================

high: clear match to rubric
medium: borderline case
low: insufficient description or ambiguous
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
            "name": "submit_relevance_scores",
            "description": "Submit relevance feature scores for dish categories in Japanese dining-out market.",
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
                                "features": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "feature_type": {
                                                "type": "string",
                                                "enum": ["timeSlot", "scene", "satiety", "taste"]
                                            },
                                            "feature_key": {
                                                "type": "string"
                                            },
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
                                        "required": ["feature_type", "feature_key", "score", "confidence", "reason"],
                                        "additionalProperties": False
                                    }
                                }
                            },
                            "required": ["item_qid", "features"],
                            "additionalProperties": False
                        }
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
