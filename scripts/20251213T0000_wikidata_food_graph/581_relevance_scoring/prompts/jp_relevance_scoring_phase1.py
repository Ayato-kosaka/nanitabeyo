#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_relevance_scoring_phase1.py

【目的】
#581 relevance_scoring Phase1（スコアリング）用の system/user prompt 組み立て関数

【機能】
- 外食文脈での自然さを軸にした relevance feature 付与
- timeSlot / scene / appetite / taste の4軸評価
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

You will score EACH item across 4 feature types:

A) timeSlot (時間帯適性):
   Evaluate for: morning / lunch / afternoon / dinner / late_night

B) scene (誰と食べるか):
   Evaluate for: solo / date / friends / family / drinking

C) appetite (満腹感):
   Evaluate for: hearty / normal / light

D) taste (印象タグ):
   Evaluate for: sweet / spicy / healthy / junk / alcohol

========================
SCORING RULES (UNIVERSAL)
========================

All scores must be: 0 / 0.5 / 1

score = 1:
- Strong natural fit for this context
- Commonly seen and expected in this scenario

score = 0.5:
- Possible but not typical
- Borderline / uncertain fit
- **DEFAULT when in doubt**

score = 0:
- Unnatural or inappropriate for this context
- Rarely or never seen in this scenario

========================
RUBRIC: A) timeSlot
========================

Evaluate how naturally this category fits each time slot in dining-out contexts.

morning (朝食時):
- 1: 朝食の定番メニュー（例: トースト、和定食、コーヒー、朝カレー）
- 0.5: 朝でも注文可能だが定番ではない（例: ピザ、パスタ、うどん）
- 0: 朝には不自然（例: 焼肉、しゃぶしゃぶ、深夜系メニュー）

lunch (昼食時):
- 1: 昼食の主力メニュー（例: ラーメン、定食、カレー、丼もの、パスタ）
- 0.5: 昼でも可能だが主力ではない（例: コース料理、フルデザート）
- 0: 昼には不自然（例: 深夜限定メニュー）

afternoon (カフェタイム・おやつ時):
- 1: カフェタイムの定番（例: ケーキ、パフェ、コーヒー、軽食）
- 0.5: おやつでも可能だが主力ではない（例: ラーメン、定食）
- 0: おやつ時には不自然（例: 焼肉、鍋料理、フルコース）

dinner (夕食時):
- 1: 夕食の主力メニュー（例: 焼肉、寿司、天ぷら、鍋料理、居酒屋メニュー）
- 0.5: 夕食でも可能だが主力ではない（例: モーニングセット）
- 0: 夕食には不自然（例: なし。ほぼすべてのメニューが夕食で可能）

late_night (深夜・二次会):
- 1: 深夜・二次会の定番（例: ラーメン、餃子、焼き鳥、酒類）
- 0.5: 深夜でも可能だが定番ではない（例: カレー、牛丼）
- 0: 深夜には不自然（例: モーニングセット、ランチ限定メニュー）

========================
RUBRIC: B) scene
========================

Evaluate how naturally this category fits each social scenario.

solo (一人飯):
- 1: 一人で気軽に食べる定番（例: ラーメン、牛丼、カレー、定食）
- 0.5: 一人でも可能だが主力ではない（例: コース料理、鍋料理）
- 0: 一人では不自然（例: 大皿料理、パーティーメニュー）

date (デート):
- 1: デートで選ばれる定番（例: フレンチ、イタリアン、おしゃれカフェメニュー）
- 0.5: デートでも可能だが定番ではない（例: ラーメン、牛丼）
- 0: デートには不自然（例: 大衆食堂メニュー、ガッツリ系メニュー）

friends (友達と):
- 1: 友達との食事で定番（例: 焼肉、居酒屋メニュー、カジュアル料理全般）
- 0.5: 友達とでも可能だが定番ではない（例: 高級フレンチ、一人向けメニュー）
- 0: 友達とは不自然（例: ほぼなし。多くのメニューが該当）

family (家族と):
- 1: 家族での食事で定番（例: ファミレスメニュー、回転寿司、焼肉、定食）
- 0.5: 家族でも可能だが定番ではない（例: 高級料理、アルコール特化メニュー）
- 0: 家族では不自然（例: 深夜系メニュー、大人向けアルコール専門）

drinking (飲み会・酒席):
- 1: 飲み会の定番（例: 焼き鳥、枝豆、刺身、つまみ系全般、ビール・酒類）
- 0.5: 飲み会でも可能だが主力ではない（例: ラーメン、カレー、デザート）
- 0: 飲み会には不自然（例: モーニングメニュー、子供向けメニュー）

========================
RUBRIC: C) appetite
========================

Evaluate the typical satiety level of this category.

hearty (ガッツリ・満腹感高):
- 1: ボリュームがあり満腹になる（例: 焼肉、しゃぶしゃぶ、大盛りメニュー）
- 0.5: 中程度の満腹感（例: 定食、カレー、パスタ）
- 0: 軽め・満腹感低（例: サラダ、スープ、つまみ、デザート）

normal (普通の満腹感):
- 1: 一般的な食事量（例: 定食、ラーメン、カレー、丼もの）
- 0.5: やや軽めまたは重め（例: 小鉢、一品料理、セットメニュー）
- 0: 明確に軽めまたは重め（例: サラダのみ、ビュッフェ）

light (軽め・満腹感低):
- 1: 少量・軽食（例: サラダ、スープ、つまみ、デザート、軽食）
- 0.5: やや軽め（例: 一品料理、小鉢、カフェメニュー）
- 0: ガッツリ系（例: 焼肉、大盛りメニュー）

========================
RUBRIC: D) taste
========================

Evaluate the dominant taste/impression tags (multiple 1.0 allowed).

sweet (甘い):
- 1: 明確に甘い（例: デザート全般、和菓子、甘味処メニュー）
- 0.5: やや甘い要素がある（例: 照り焼き、甘辛タレ）
- 0: 甘くない（例: 塩味・辛味中心のメニュー）

spicy (辛い):
- 1: 明確に辛い（例: 麻婆豆腐、カレー、キムチ、唐辛子系）
- 0.5: やや辛い要素がある（例: ピリ辛メニュー）
- 0: 辛くない（例: 和食全般、甘味系）

healthy (ヘルシー印象):
- 1: ヘルシー印象が強い（例: サラダ、野菜料理、蒸し料理、和食）
- 0.5: やや健康的（例: 定食、バランス系メニュー）
- 0: ヘルシー印象が弱い（例: 揚げ物、ジャンクフード、油分多め）

junk (ジャンク印象):
- 1: ジャンク印象が強い（例: ハンバーガー、ポテト、揚げ物、ファストフード）
- 0.5: ややジャンク（例: ラーメン、丼もの、カレー）
- 0: ジャンク印象なし（例: 和食、懐石、サラダ）

alcohol (アルコール):
- 1: アルコール飲料そのもの（例: ビール、ワイン、日本酒、カクテル）
- 0.5: アルコール含有料理・デザート（例: ワイン煮、洋酒漬け）
- 0: アルコール非含有（例: ほぼすべての料理）

========================
CRITICAL GUARDRAILS
========================

1) When in doubt -> score = 0.5

2) Consistency > precision
   (一貫性を最優先。迷ったら 0.5)

3) Do NOT consider:
   - Popularity / trendiness
   - Age / generation differences
   - Personal preference
   - Health / diet consciousness

4) ONLY consider:
   - Contextual naturalness in Japanese dining-out market

========================
INPUT USAGE RULES
========================

Primary signals:
- label_ja (category name)
- desc_ja (description)
- aliases_top_ja (aliases)

item_qid is an identifier only.

========================
OUTPUT FORMAT (STRICT)
========================

Return exactly one structured result per item using the tool spec.

For each item, output ALL features:
- timeSlot: morning, lunch, afternoon, dinner, late_night
- scene: solo, date, friends, family, drinking
- appetite: hearty, normal, light
- taste: sweet, spicy, healthy, junk, alcohol

Each feature must have:
- score: 0, 0.5, or 1
- confidence: high / medium / low
- reason: short tag (max 120 chars, Japanese OK)

Confidence guidance:
- high: clear match to rubric
- medium: borderline case
- low: insufficient description or ambiguous
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
                                                "enum": ["timeSlot", "scene", "appetite", "taste"]
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
