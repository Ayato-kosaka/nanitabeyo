#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
metrics.py

【目的】
メトリクス集計・レポート出力（#575 dine_out_orderability 用）

【機能】
- Token 集計
- スコア・confidence 分布集計
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
    
    def collect_metrics(self, results: List[Dict], batch_responses: List[Dict]) -> Dict[str, Any]:
        """
        メトリクスを集計
        
        Args:
            results: パース済み結果のリスト
            batch_responses: Batch API の生レスポンスリスト
            
        Returns:
            メトリクス辞書
        """
        metrics = {
            "input_count": len(results),
            "success_count": len([r for r in results if r.get("score") is not None]),
            "error_count": len([r for r in results if r.get("score") is None]),
            "score_distribution": self._count_score_distribution(results),
            "confidence_distribution": self._count_confidence_distribution(results),
            "tokens": self._collect_token_stats(batch_responses)
        }
        
        self.metrics = metrics
        logger.info(f"Metrics collected: {metrics['input_count']} items")
        return metrics
    
    def _count_score_distribution(self, results: List[Dict]) -> Dict[str, int]:
        """
        スコア分布を集計
        
        Args:
            results: 結果リスト
            
        Returns:
            スコア別の件数辞書
        """
        scores = [r.get("score") for r in results if r.get("score") is not None]
        score_counts = Counter(scores)
        
        # 0, 0.5, 1 の順で整形
        distribution = {
            "0": score_counts.get(0, 0),
            "0.5": score_counts.get(0.5, 0),
            "1": score_counts.get(1, 0)
        }
        
        return distribution
    
    def _count_confidence_distribution(self, results: List[Dict]) -> Dict[str, int]:
        """
        confidence 分布を集計
        
        Args:
            results: 結果リスト
            
        Returns:
            confidence 別の件数辞書
        """
        confidences = [r.get("confidence") for r in results if r.get("confidence")]
        confidence_counts = Counter(confidences)
        
        distribution = {
            "high": confidence_counts.get("high", 0),
            "medium": confidence_counts.get("medium", 0),
            "low": confidence_counts.get("low", 0)
        }
        
        return distribution
    
    def _collect_token_stats(self, batch_responses: List[Dict]) -> Dict[str, Any]:
        """
        Token 統計を集計
        
        Args:
            batch_responses: Batch API レスポンスリスト
            
        Returns:
            Token 統計辞書
        """
        input_tokens = []
        output_tokens = []
        
        for response in batch_responses:
            usage = response.get("response", {}).get("body", {}).get("usage", {})
            if usage:
                input_tokens.append(usage.get("prompt_tokens", 0))
                output_tokens.append(usage.get("completion_tokens", 0))
        
        if not input_tokens:
            return {
                "avg_input_tokens": 0,
                "avg_output_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0
            }
        
        return {
            "avg_input_tokens": round(sum(input_tokens) / len(input_tokens), 2),
            "avg_output_tokens": round(sum(output_tokens) / len(output_tokens), 2),
            "p50_input_tokens": self._percentile(input_tokens, 50),
            "p95_input_tokens": self._percentile(input_tokens, 95),
            "p50_output_tokens": self._percentile(output_tokens, 50),
            "p95_output_tokens": self._percentile(output_tokens, 95),
            "total_input_tokens": sum(input_tokens),
            "total_output_tokens": sum(output_tokens)
        }
    
    def _percentile(self, values: List[float], percentile: int) -> float:
        """
        パーセンタイルを計算
        
        Args:
            values: 値のリスト
            percentile: パーセンタイル（0-100）
            
        Returns:
            パーセンタイル値
        """
        if not values:
            return 0
        
        sorted_values = sorted(values)
        index = int(len(sorted_values) * percentile / 100)
        
        # インデックスが範囲外にならないよう調整
        if index >= len(sorted_values):
            index = len(sorted_values) - 1
        
        return sorted_values[index]
    
    def print_report(self) -> None:
        """メトリクスレポートを標準出力に表示"""
        if not self.metrics:
            logger.warning("No metrics to report")
            return
        
        print("\n" + "=" * 80)
        print("METRICS REPORT")
        print("=" * 80)
        
        print(f"\n📊 Count Statistics:")
        print(f"  Input count:   {self.metrics['input_count']}")
        print(f"  Success count: {self.metrics['success_count']}")
        print(f"  Error count:   {self.metrics['error_count']}")
        
        print(f"\n🎯 Score Distribution:")
        for score, count in self.metrics["score_distribution"].items():
            percentage = count / self.metrics["success_count"] * 100 if self.metrics["success_count"] > 0 else 0
            print(f"  score={score}: {count} ({percentage:.1f}%)")
        
        print(f"\n📈 Confidence Distribution:")
        for conf, count in self.metrics["confidence_distribution"].items():
            percentage = count / self.metrics["success_count"] * 100 if self.metrics["success_count"] > 0 else 0
            print(f"  {conf}: {count} ({percentage:.1f}%)")
        
        print(f"\n💰 Token Usage:")
        tokens = self.metrics["tokens"]
        print(f"  Avg input tokens:  {tokens.get('avg_input_tokens', 0)}")
        print(f"  Avg output tokens: {tokens.get('avg_output_tokens', 0)}")
        print(f"  Total input:       {tokens.get('total_input_tokens', 0)}")
        print(f"  Total output:      {tokens.get('total_output_tokens', 0)}")
        print(f"  Total:             {tokens.get('total_input_tokens', 0) + tokens.get('total_output_tokens', 0)}")
        
        print("=" * 80 + "\n")
    
    def save_to_file(self, file_path: Path) -> None:
        """
        メトリクスを JSON ファイルに保存
        
        Args:
            file_path: 保存先ファイルパス
        """
        if not self.metrics:
            logger.warning("No metrics to save")
            return
        
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(self.metrics, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Metrics saved to {file_path}")
