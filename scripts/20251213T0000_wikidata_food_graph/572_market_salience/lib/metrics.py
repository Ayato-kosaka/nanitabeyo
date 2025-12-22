#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
metrics.py

【目的】
メトリクス集計・レポート出力（#572 market_salience 用）

【機能】
- Token 集計
- Pass2 発火率計算
- スコア・confidence 分布集計
- is_regional 真率計算
- レポート出力（stdout + JSON ファイル）
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Any
from collections import Counter

logger = logging.getLogger(__name__)


class MetricsCollector:
    """メトリクス集計クラス"""
    
    def __init__(self):
        self.metrics = {}
    
    def collect_pass1_metrics(self, results: List[Dict], batch_responses: List[Dict]) -> Dict[str, Any]:
        """
        Pass1 のメトリクスを集計
        
        Args:
            results: パース済み結果のリスト
            batch_responses: Batch API の生レスポンスリスト
            
        Returns:
            Pass1 メトリクス辞書
        """
        metrics = {
            "input_count": len(results),
            "success_count": len([r for r in results if r.get("score") is not None]),
            "error_count": len([r for r in results if r.get("score") is None]),
            "score_distribution": self._count_score_distribution(results),
            "confidence_distribution": self._count_confidence_distribution(results),
            "is_regional_rate": self._calculate_regional_rate(results),
            "tokens": self._collect_token_stats(batch_responses)
        }
        
        self.metrics["pass1"] = metrics
        logger.info(f"Pass1 metrics collected: {metrics['input_count']} items")
        return metrics
    
    def collect_pass2_metrics(
        self,
        p1_results: List[Dict],
        p2_results: List[Dict],
        p2_batch_responses: List[Dict]
    ) -> Dict[str, Any]:
        """
        Pass2 のメトリクスを集計
        
        Args:
            p1_results: Pass1 の結果リスト
            p2_results: Pass2 の結果リスト
            p2_batch_responses: Pass2 の Batch API レスポンスリスト
            
        Returns:
            Pass2 メトリクス辞書
        """
        triggered_count = len(p2_results)
        p1_total = len(p1_results)
        trigger_rate = triggered_count / p1_total if p1_total > 0 else 0
        
        metrics = {
            "triggered_count": triggered_count,
            "trigger_rate": round(trigger_rate, 4),
            "success_count": len([r for r in p2_results if r.get("score") is not None]),
            "error_count": len([r for r in p2_results if r.get("score") is None]),
            "score_distribution": self._count_score_distribution(p2_results),
            "confidence_distribution": self._count_confidence_distribution(p2_results),
            "is_regional_rate": self._calculate_regional_rate(p2_results),
            "tokens": self._collect_token_stats(p2_batch_responses)
        }
        
        self.metrics["pass2"] = metrics
        logger.info(f"Pass2 metrics collected: trigger_rate={trigger_rate:.2%}")
        return metrics
    
    def _count_score_distribution(self, results: List[Dict]) -> Dict[str, int]:
        """スコア分布をカウント"""
        scores = [r.get("score") for r in results if r.get("score") is not None]
        counter = Counter(scores)
        return {str(k): v for k, v in sorted(counter.items())}
    
    def _count_confidence_distribution(self, results: List[Dict]) -> Dict[str, int]:
        """Confidence 分布をカウント"""
        confidences = [r.get("confidence") for r in results if r.get("confidence")]
        counter = Counter(confidences)
        return dict(counter)
    
    def _calculate_regional_rate(self, results: List[Dict]) -> float:
        """is_regional=True の割合を計算"""
        total = len(results)
        if total == 0:
            return 0.0
        regional_count = sum(1 for r in results if r.get("is_regional") is True)
        return round(regional_count / total, 4)
    
    def _collect_token_stats(self, batch_responses: List[Dict]) -> Dict[str, Any]:
        """Token 統計を集計"""
        input_tokens = []
        output_tokens = []
        
        for response in batch_responses:
            usage = response.get("response", {}).get("body", {}).get("usage", {})
            if usage:
                input_tokens.append(usage.get("prompt_tokens", 0))
                output_tokens.append(usage.get("completion_tokens", 0))
        
        if not input_tokens:
            return {"avg_input": 0, "avg_output": 0, "total_input": 0, "total_output": 0}
        
        return {
            "avg_input": round(sum(input_tokens) / len(input_tokens), 1),
            "avg_output": round(sum(output_tokens) / len(output_tokens), 1),
            "p50_input": self._percentile(input_tokens, 0.5),
            "p95_input": self._percentile(input_tokens, 0.95),
            "p50_output": self._percentile(output_tokens, 0.5),
            "p95_output": self._percentile(output_tokens, 0.95),
            "total_input": sum(input_tokens),
            "total_output": sum(output_tokens)
        }
    
    def _percentile(self, values: List[float], p: float) -> float:
        """パーセンタイルを計算"""
        if not values:
            return 0
        sorted_values = sorted(values)
        index = int(len(sorted_values) * p)
        return sorted_values[min(index, len(sorted_values) - 1)]
    
    def save_report(self, output_path: Path) -> None:
        """
        メトリクスレポートを JSON ファイルに保存
        
        Args:
            output_path: 出力先ファイルパス
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.metrics, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Metrics report saved to {output_path}")
    
    def print_summary(self) -> None:
        """メトリクスサマリーを stdout に出力"""
        print("\n" + "=" * 80)
        print("METRICS SUMMARY")
        print("=" * 80)
        
        if "pass1" in self.metrics:
            p1 = self.metrics["pass1"]
            print("\n【Pass1】")
            print(f"  Input count:       {p1['input_count']}")
            print(f"  Success count:     {p1['success_count']}")
            print(f"  Error count:       {p1['error_count']}")
            print(f"  is_regional rate:  {p1['is_regional_rate']:.2%}")
            print(f"  Tokens (avg):      input={p1['tokens']['avg_input']:.0f}, output={p1['tokens']['avg_output']:.0f}")
            print(f"  Score distribution: {p1['score_distribution']}")
            print(f"  Confidence dist:    {p1['confidence_distribution']}")
        
        if "pass2" in self.metrics:
            p2 = self.metrics["pass2"]
            print("\n【Pass2】")
            print(f"  Triggered count:   {p2['triggered_count']}")
            print(f"  Trigger rate:      {p2['trigger_rate']:.2%}")
            print(f"  Success count:     {p2['success_count']}")
            print(f"  Error count:       {p2['error_count']}")
            print(f"  is_regional rate:  {p2['is_regional_rate']:.2%}")
            print(f"  Tokens (avg):      input={p2['tokens']['avg_input']:.0f}, output={p2['tokens']['avg_output']:.0f}")
            print(f"  Score distribution: {p2['score_distribution']}")
            print(f"  Confidence dist:    {p2['confidence_distribution']}")
        
        print("\n" + "=" * 80)
