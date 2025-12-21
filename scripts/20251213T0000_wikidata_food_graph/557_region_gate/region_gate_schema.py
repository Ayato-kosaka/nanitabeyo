#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
region_gate_schema.py

【目的】
#557 region gate 用の tool spec と response parser

【機能】
- tool specification 生成
- response parsing と validation
"""

import json
import logging
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict, Any

logger = logging.getLogger(__name__)


# #557 【設計】region gate decision 定義
VALID_REGION_DECISIONS = ["allow", "deny", "uncertain"]
VALID_CONFIDENCE = ["high", "medium", "low"]


@dataclass
class ParseError:
    code: str
    message: str


def build_tool_spec(n_items: int) -> Dict[str, Any]:
    """
    #557 region gate 用 tool specification を生成
    
    Args:
        n_items: 入力アイテム数
        
    Returns:
        tool spec 辞書
    """
    spec = {
        "type": "function",
        "function": {
            "name": "submit_region_gate_decisions",
            "description": "Submit region gate decisions for the provided Wikidata items.",
            "parameters": {
                "type": "object",
                "properties": {
                    "results": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item_qid": {"type": "string"},
                                "decision": {"type": "string", "enum": VALID_REGION_DECISIONS},
                                "confidence": {"type": "string", "enum": VALID_CONFIDENCE},
                                "reason": {"type": "string", "maxLength": 120}
                            },
                            "required": ["item_qid", "decision", "confidence", "reason"],
                            "additionalProperties": False
                        }
                    }
                },
                "required": ["results"],
                "additionalProperties": False
            }
        }
    }
    spec["function"]["parameters"]["properties"]["results"]["minItems"] = n_items
    spec["function"]["parameters"]["properties"]["results"]["maxItems"] = n_items
    return spec


def parse_response(response_obj: Dict[str, Any], expected_items: Optional[List[Dict]] = None
                ) -> Tuple[Optional[List[Dict]], Optional[ParseError]]:
    """
    #557 region gate response をパース
    
    Args:
        response_obj: OpenAI APIのレスポンス（JSON）
        expected_items: 入力items（順序・件数検証に使う）
        
    Returns:
        (parsed_results, error) のタプル
    """
    try:
        choice = response_obj["choices"][0]
        msg = choice["message"]

        # tool_calls がある想定
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            return None, ParseError("no_tool_calls", "No tool_calls in response")

        call0 = tool_calls[0]
        fn = call0.get("function", {})
        if fn.get("name") != "submit_region_gate_decisions":
            return None, ParseError("wrong_function", f"Unexpected function: {fn.get('name')}")

        args_str = fn.get("arguments", "")
        try:
            args = json.loads(args_str)
        except Exception as e:
            return None, ParseError("bad_arguments_json", f"Failed to parse function arguments JSON: {e}")

        results = args.get("results")
        if not isinstance(results, list):
            return None, ParseError("missing_results", "Missing or invalid 'results'")

        # 件数/順序検証
        if expected_items is not None:
            if len(results) != len(expected_items):
                return None, ParseError(
                    "length_mismatch",
                    f"results length {len(results)} != expected {len(expected_items)}"
                )
            # item_qidが一致しているか（順序一致も担保）
            for r, exp in zip(results, expected_items):
                if r.get("item_qid") != exp.get("item_qid"):
                    return None, ParseError(
                        "qid_mismatch",
                        f"item_qid mismatch: {r.get('item_qid')} != {exp.get('item_qid')}"
                    )

        # 値のバリデーション
        validated = []
        for r in results:
            decision = r.get("decision")
            conf = r.get("confidence")
            reason = r.get("reason") or ""
            
            if decision not in VALID_REGION_DECISIONS:
                return None, ParseError("invalid_decision", f"Invalid decision: {decision}")
            if conf not in VALID_CONFIDENCE:
                return None, ParseError("invalid_confidence", f"Invalid confidence: {conf}")
            if len(reason) > 120:
                return None, ParseError("reason_too_long", f"Reason too long: {len(reason)} chars")
            if len(reason.split()) > 20:
                return None, ParseError("reason_too_many_words", f"Reason too many words: {len(reason.split())} words")
            
            validated.append(r)
    
        return validated, None

    except Exception as e:
        return None, ParseError("unexpected", str(e))
