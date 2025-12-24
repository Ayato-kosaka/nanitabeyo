#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】メトリクス計算ライブラリ

Token統計、Pass2発火率、confidence分布などを計算
"""

import logging
from typing import List, Dict
from collections import defaultdict

logger = logging.getLogger(__name__)


def calculate_metrics(
    input_count: int,
    results: List[Dict],
    errors: List[Dict],
    pass2_triggered: int = 0
) -> Dict:
    """
    メトリクスを計算
    
    Args:
        input_count: 入力アイテム数
        results: 成功した結果のリスト
        errors: エラーのリスト
        pass2_triggered: Pass2 発火数（Pass1 実行時のみ）
        
    Returns:
        メトリクス辞書
    """
    logger.info("Calculating metrics...")
    
    success_count = len(results)
    error_count = len(errors)
    
    # #582 【設計】confidence 分布
    confidence_dist = defaultdict(int)
    for r in results:
        confidence_dist[r.get("confidence", "unknown")] += 1
    
    # #582 【設計】locale 別内訳
    locale_dist = defaultdict(int)
    for r in results:
        locale_dist[r.get("locale", "unknown")] += 1
    
    metrics = {
        "count": {
            "input": input_count,
            "success": success_count,
            "error": error_count
        },
        "confidence_distribution": dict(confidence_dist),
        "locale_distribution": dict(locale_dist)
    }
    
    # #582 【設計】Pass2 発火率（Pass1 実行時のみ）
    if pass2_triggered > 0:
        trigger_rate = pass2_triggered / success_count if success_count > 0 else 0
        metrics["pass2"] = {
            "triggered_count": pass2_triggered,
            "trigger_rate": round(trigger_rate, 3)
        }
    
    logger.info(f"Metrics calculated: {metrics}")
    return metrics


def print_metrics(metrics: Dict) -> None:
    """
    メトリクスをコンソールに出力
    
    Args:
        metrics: メトリクス辞書
    """
    print("\n" + "=" * 80)
    print("Metrics Summary")
    print("=" * 80)
    
    print("\n[Count]")
    for key, value in metrics["count"].items():
        print(f"  {key}: {value}")
    
    print("\n[Confidence Distribution]")
    for key, value in metrics["confidence_distribution"].items():
        print(f"  {key}: {value}")
    
    print("\n[Locale Distribution]")
    for key, value in metrics["locale_distribution"].items():
        print(f"  {key}: {value}")
    
    if "pass2" in metrics:
        print("\n[Pass2 Trigger]")
        print(f"  triggered_count: {metrics['pass2']['triggered_count']}")
        print(f"  trigger_rate: {metrics['pass2']['trigger_rate']:.1%}")
    
    print("\n" + "=" * 80 + "\n")
