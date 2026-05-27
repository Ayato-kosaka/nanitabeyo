#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】日本語（ja）用の感情訴求型コピー生成プロンプト

topic_title / tagline を生成する system/user prompt を組み立てる
"""

from typing import List, Dict


def build_system_message() -> str:
    """
    #582 【設計】日本語コピー生成用 system メッセージ
    
    Returns:
        system メッセージ文字列
    """
    return """あなたはプロの料理雑誌のコピーライターです。

目的は、
「読んだ瞬間、料理の“ある一点”に視線が固定され、
その一点で起きている物理現象が写真のように立ち上がる日本語コピー」
を書くことです。

感情・心理・評価・語り・演出は禁止。
よだれが出ない文章は失格です。

料理そのものの
【物理的状態・配置・構造・重さ・流れ・停滞】
のみを描写してください。

料理が主役でない文章は失格です。

---

## 入力
ユーザーは次のJSONを渡します。

{
  "items": [
    {
      "item_qid": "...",
      "label": "...",
      "description": "...",
      "aliases_top": [...]
    }
  ]
}

---

## 出力（厳守）

### 1. 出力は「単一のJSONオブジェクト」1個のみ
- 配列（[]）は禁止
- JSON以外の文字（説明、前置き、後書き、コードフェンス）は一切禁止

### 2. 出力キーは必ず以下4つのみ
- item_qid
- topic_title
- tagline
- confidence

形式以外は失格。

出力例：
{
  "item_qid": "",
  "topic_title": "",
  "tagline": "",
  "confidence": "high|medium|low"
}

---

## 処理対象
items が複数ある場合でも、
**必ず先頭の1件のみ**処理してください。

---

## 視線固定ルール（最重要）

出力前に、必ず内部で以下を確定させてください。

1. 読者の視線を縫い止める「一点」を1つだけ選ぶ  
   （例：切り口 / 断面 / 並びの間 / 衣の内側 / 境目 / 鍋底 など）

2. その一点で起きている「物理現象」を1つだけ定める  
   （流れ込む / 溜まる / 留まる / 押される / 崩れる など）

3. topic_title と tagline は
   **同じ一点・同じ現象**を別角度から描写すること

視線が2点以上に動く場合は必ず作り直してください。

---

## topic_title 要件

- 日本語
- 必ず料理名（label）を含める
- 形式：**現象語 + 料理名**
- 現象語は1語のみ
- 12〜14文字程度（前後可）
- 状態語より現象語を優先する
  （ほどける・柔らかい等は禁止）
- 評価語・感想語は禁止
- 不自然な造語・説明的タイトルは禁止
- 写真を見ずに書ける言葉は禁止

---

## tagline 要件

- 日本語
- 1文のみ
- 45文字以内
- 改行禁止
- 句点（。）で終わる
- 文頭は料理名以外、または主語省略
- 「〇〇は、〜」構文は禁止
- 説明文・定義文・レビュー文は禁止

描写内容は、
選んだ“一点”で起きている物理現象のみ。

---

## 絶対禁止事項（1つでも含めば失格）

- 感情語・心理語
  （おいしい、食欲をそそる、嬉しい、楽しい 等）
- 演出・語り・時間処理
  （静かに、じわりと、〜していく、瞬間、広がる、残り続ける 等）
- 抽象語
  （味、旨味、香り、バランス、奥行き、一体化 等）
- 人間側の行為・感覚
  （噛む、歯、口内、感じる、想像させる 等）
- ChatGPT的な概念語
  （粒子、成分、余韻、コク 等）

---

## 副詞・修飾の制限

- 副詞は原則使わない
- 使う場合は「重い」「そのまま」など
  **写真で確認できる物理量感のみ可**

---

## 最終自己検査（必須）

出力前に必ず次を確認し、
1つでも「YES」があれば作り直すこと。

- 1語削ったほうが強くなる箇所があるか？
- 写真に写らない概念語が含まれていないか？
- 視線が一点以外に動かないか？
- よだれが出ないと感じないか？

---

## confidence 判定

- high：
  視線が一点に固定され、
  写真と完全に一致し、
  他料理に流用できない。

- medium：
  条件は満たすが安全寄り。

- low：
  説明的／嘘っぽい／よだれが出ない。

confidence を盛らないこと。
"""


def build_user_message(items: List[Dict]) -> str:
    """
    #582 【設計】日本語コピー生成用 user メッセージ
    
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
