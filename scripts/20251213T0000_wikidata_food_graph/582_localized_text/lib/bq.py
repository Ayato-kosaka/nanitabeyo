#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#582 【設計】BigQuery 操作ライブラリ

入力データ抽出、結果ロード、catalog publish を担当
"""

import logging
from datetime import datetime, timezone
from typing import List, Dict
from google.cloud import bigquery

logger = logging.getLogger(__name__)


class BigQueryClient:
    """BigQuery 操作クライアント"""
    
    def __init__(self, project_id: str, dataset_id: str):
        self.client = bigquery.Client(project=project_id)
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.dataset_ref = f"{project_id}.{dataset_id}"
    
    def export_input(self, sql_template: str, params: Dict) -> List[Dict]:
        """
        入力データを BigQuery から抽出
        
        Args:
            sql_template: SQL テンプレート
            params: パラメータ辞書（dataset, limit_clause など）
            
        Returns:
            抽出されたアイテムのリスト
        """
        sql = sql_template.format(**params)
        logger.info("Executing query to export input data...")
        logger.debug(f"SQL: {sql}")
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        items = [dict(row) for row in results]
        logger.info(f"Exported {len(items)} items")
        
        return items
    
    def load_generations(
        self,
        generations: List[Dict],
        table_name: str = "wikidata_food_copy_generations"
    ) -> None:
        """
        生成結果を BigQuery にロード
        
        Args:
            generations: 生成結果のリスト
                         [{'item_qid': 'Q...', 'locale': 'ja',
                           'topic_title': '...', 'tagline': '...', 
                           'confidence': 'high', 'model': 'gpt-4.1-mini', 
                           'run_id': '...', 'note': '...'}, ...]
            table_name: テーブル名
        """
        if not generations:
            logger.warning("No generations to load")
            return
        
        table_id = f"{self.dataset_ref}.{table_name}"
        logger.info(f"Loading {len(generations)} generations to {table_id}")
        
        # #582 【設計】created_at を追加
        now = datetime.now(timezone.utc).isoformat()
        rows_to_insert = [
            {
                "item_qid": gen["item_qid"],
                "locale": gen["locale"],
                "topic_title": gen["topic_title"],
                "tagline": gen["tagline"],
                "confidence": gen["confidence"],
                "model": gen["model"],
                "run_id": gen["run_id"],
                "created_at": now,
                "note": gen.get("note", "")
            }
            for gen in generations
        ]
        
        errors = self.client.insert_rows_json(table_id, rows_to_insert)
        
        if errors:
            logger.error(f"Errors occurred while loading generations: {errors}")
            raise Exception(f"Failed to load generations: {errors}")
        
        logger.info(f"Successfully loaded {len(generations)} generations")
    
    def publish_catalog(
        self,
        sql_template: str,
        params: Dict
    ) -> int:
        """
        catalog への publish を実行
        
        Args:
            sql_template: SQL テンプレート（MERGE 文）
            params: パラメータ辞書（dataset, pass1_run_id, pass2_run_id, adopt_confidence）
            
        Returns:
            影響を受けた行数
        """
        sql = sql_template.format(**params)
        logger.info("Executing MERGE to publish catalog...")
        logger.debug(f"SQL: {sql}")
        
        job = self.client.query(sql)
        job.result()
        affected = job.num_dml_affected_rows or 0
        
        logger.info(f"Published {affected} rows to catalog")
        return affected
    
    def get_generation_stats(
        self,
        run_id: str,
        table_name: str = "wikidata_food_copy_generations"
    ) -> Dict:
        """
        生成結果の統計情報を取得
        
        Args:
            run_id: run_id
            table_name: テーブル名
            
        Returns:
            統計情報辞書
        """
        table_id = f"{self.dataset_ref}.{table_name}"
        logger.info(f"Fetching generation stats for run_id={run_id}...")
        
        sql = f"""
        SELECT
          locale,
          confidence,
          COUNT(*) as count
        FROM `{table_id}`
        WHERE run_id = '{run_id}'
        GROUP BY locale, confidence
        ORDER BY locale, confidence
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        stats = {}
        for row in results:
            key = f"{row.locale}_{row.confidence}"
            stats[key] = row.count
        
        logger.info(f"Statistics: {stats}")
        return stats
