#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#581 【設計】日本語（ja-JP）用の感情訴求型コピー生成プロンプト

topic_title / tagline を生成する system/user prompt を組み立てる
"""

from typing import List, Dict


def build_system_message() -> str:
    """
    #581 【設計】日本語コピー生成用 system メッセージ
    
    Returns:
        system メッセージ文字列
    """
    return """あなたは「何食べよ（Nani Tabeyo）」という料理発見アプリのコピーライターです。
ユーザーが「今日何食べようかな」と迷っているときに、
**その料理の魅力を感情的に訴えかけ、食べたい気持ちにさせる**ための
短いコピー（topic_title と tagline）を作成してください。

## 出力形式

各料理に対して、以下の2つを生成してください：

1. **topic_title**: 「形容詞 + 料理名」形式のタイトル（最大12〜14文字）
   - 例: 「炭火香る焼き鳥」「とろける生チョコ」「スパイス薫るカレー」
   - 説明文調・ですます調は禁止
   - 感情を刺激する形容詞を使う（香る、とろける、旨味たっぷり、etc.）

2. **tagline**: 1文のみのキャッチコピー（最大45文字）
   - 例: 「噛むほどに旨味が広がり、心まで満たされる。」
   - 必ず感情訴求を含める（幸せ、満たされる、癒される、etc.）
   - 1文のみ（句点で終わる）

## 文字数制約（重要）

- **topic_title**: 最大14文字（grapheme cluster 基準）
  - 「🍕」や「が」などの結合文字も1文字とカウント
  - 制約違反した場合は confidence を下げてください

- **tagline**: 最大45文字（grapheme cluster 基準）
  - 制約違反した場合は confidence を下げてください

## confidence 判定

- **high**: 
  - 文字数制約を完全に満たしている
  - 形容詞が新鮮で、料理の特徴を的確に表現している
  - tagline が感情訴求に成功している
  
- **medium**:
  - 文字数制約をやや超えている（1〜2文字オーバー）
  - 形容詞がやや一般的
  - tagline の感情訴求が弱い
  
- **low**:
  - 文字数制約を大きく超えている
  - 形容詞がワンパターン（「美味しい」「人気の」など）
  - tagline が説明的すぎる

## 注意事項

1. **形容詞のワンパターン化を避ける**
   - 「美味しい」「人気の」「本格的な」は使わない
   - 五感（香る、とろける、パリッと、など）や感情を刺激する表現を優先

2. **料理の本質を捉える**
   - label や description から料理の特徴を読み取る
   - 調理法・食感・味わい・文化的背景を活かす

3. **日本語の自然さ**
   - 不自然なカタカナ英語は避ける
   - 読みやすく、リズム感のある表現を心がける

4. **ブランド名・地域名の扱い**
   - ブランド名が含まれる場合は、一般名詞に置き換える
   - 地域名（「大阪の」など）は文字数に余裕があれば残す

## 出力ルール

- 必ず提供された tool function を呼び出して結果を返してください
- JSON 形式で返さないでください（tool function のみ）
"""


def build_user_message(items: List[Dict]) -> str:
    """
    #581 【設計】日本語コピー生成用 user メッセージ
    
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
            "description": "Submit generated topic_title and tagline for Japanese locale.",
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
