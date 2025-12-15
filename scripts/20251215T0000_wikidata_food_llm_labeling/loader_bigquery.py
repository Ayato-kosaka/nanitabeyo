#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loader_bigquery.py

【目的】
BigQuery へのデータロードと処理ロジック

【機能】
- LLM ラベリング結果のロード
- dish_blacklist への反映
"""

import logging
from typing import List, Dict
from datetime import datetime
from google.cloud import bigquery

logger = logging.getLogger(__name__)


class BigQueryLoader:
    """BigQuery へのデータロードと処理を管理するクラス"""
    
    def __init__(self, project_id: str, dataset_id: str):
        self.client = bigquery.Client(project=project_id)
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.dataset_ref = f"{project_id}.{dataset_id}"
    
    def execute_sql(self, sql: str) -> bigquery.table.RowIterator:
        """
        SQL を実行する
        
        Args:
            sql: 実行する SQL 文字列
            
        Returns:
            クエリ結果
        """
        logger.info(f"Executing SQL...")
        job = self.client.query(sql)
        result = job.result()  # Wait for completion
        logger.info(f"SQL execution completed")
        return result
    
    def execute_migration(self, migration_file_path: str) -> None:
        """
        migration SQL ファイルを読み込んで実行
        
        Args:
            migration_file_path: migration SQL ファイルのパス
        """
        logger.info(f"Executing migration: {migration_file_path}")
        
        with open(migration_file_path, 'r', encoding='utf-8') as f:
            sql = f.read()
        
        # ${DATASET} を実際の dataset に置換
        sql = sql.replace("${DATASET}", self.dataset_ref)
        
        self.execute_sql(sql)
        logger.info("Migration completed")
    
    def load_llm_labels(
        self,
        labels: List[Dict],
        task: str,
        model: str,
        run_id: str
    ) -> None:
        """
        wikidata_food_llm_labels テーブルに LLM ラベリング結果をロード
        
        Args:
            labels: ラベル情報のリスト
                    [{'item_qid': 'Q12345', 'label': 'keep', 'confidence': 'high', 'reason': '...'}, ...]
            task: タスク識別子（例: '#548_menu_blacklist_classification'）
            model: モデル名（例: 'gpt-4.1-mini'）
            run_id: バッチ実行ごとの識別子（例: '20251215T0000_v1'）
        """
        if not labels:
            logger.warning("No labels to load")
            return
        
        table_id = f"{self.dataset_ref}.wikidata_food_llm_labels"
        logger.info(f"Loading {len(labels)} labels to {table_id}")
        
        # データを準備
        current_time = datetime.utcnow().isoformat()
        rows_to_insert = [
            {
                "item_qid": label["item_qid"],
                "task": task,
                "label": label["label"],
                "confidence": label["confidence"],
                "reason": label.get("reason"),
                "model": model,
                "run_id": run_id,
                "created_at": current_time
            }
            for label in labels
        ]
        
        # BigQuery に INSERT
        errors = self.client.insert_rows_json(table_id, rows_to_insert)
        
        if errors:
            logger.error(f"Errors occurred while inserting rows: {errors}")
            raise Exception(f"Failed to insert rows: {errors}")
        
        logger.info(f"Successfully loaded {len(labels)} labels")
    
    def get_unlabeled_nodes(self) -> List[Dict]:
        """
        dish_blacklist 未該当ノードを取得
        
        Returns:
            未ラベルノードのリスト [{'item_qid': 'Q12345', 'label_en': '...', 'desc_en': '...'}, ...]
        """
        logger.info("Fetching unlabeled nodes from BigQuery...")
        
        sql = f"""
        WITH black AS (
          SELECT DISTINCT dish_qid
          FROM `{self.dataset_ref}.dish_blacklist`
        )
        SELECT
          fnr.item_qid,
          fnr.label_en,
          fnr.desc_en
        FROM `{self.dataset_ref}.food_nodes_raw` AS fnr
        LEFT JOIN black
          ON fnr.item_qid = black.dish_qid
        WHERE black.dish_qid IS NULL
          AND fnr.label_en IS NOT NULL
        """
        
        result = self.execute_sql(sql)
        nodes = [
            {
                "item_qid": row.item_qid,
                "label_en": row.label_en,
                "desc_en": row.desc_en
            }
            for row in result
        ]
        
        logger.info(f"Found {len(nodes)} unlabeled nodes")
        return nodes
    
    def get_llm_label_stats(self, run_id: str = None) -> Dict:
        """
        wikidata_food_llm_labels の統計情報を取得
        
        Args:
            run_id: 特定の run_id に絞る場合に指定
            
        Returns:
            統計情報の辞書
        """
        logger.info("Fetching LLM label statistics...")
        
        where_clause = f"WHERE run_id = '{run_id}'" if run_id else ""
        
        sql = f"""
        SELECT
          label,
          confidence,
          COUNT(*) as count
        FROM `{self.dataset_ref}.wikidata_food_llm_labels`
        {where_clause}
        GROUP BY label, confidence
        ORDER BY label, confidence
        """
        
        result = self.execute_sql(sql)
        stats = {}
        
        for row in result:
            key = f"{row.label}_{row.confidence}"
            stats[key] = row.count
        
        logger.info(f"Statistics: {stats}")
        return stats
    
    def apply_llm_labels_to_blacklist(self, run_id: str) -> int:
        """
        wikidata_food_llm_labels から dish_blacklist を更新
        
        Args:
            run_id: 適用する run_id
            
        Returns:
            追加された行数
        """
        logger.info(f"Applying LLM labels from run_id={run_id} to dish_blacklist...")
        
        sql = f"""
        INSERT INTO `{self.dataset_ref}.dish_blacklist` (
          dish_qid,
          reason,
          note,
          created_at
        )
        SELECT
          item_qid AS dish_qid,
          'llm_label' AS reason,
          label AS note,
          CURRENT_TIMESTAMP() AS created_at
        FROM `{self.dataset_ref}.wikidata_food_llm_labels`
        WHERE
          run_id = '{run_id}'
          AND label IN ('too_generic', 'non_menu_item', 'not_for_menu')
          AND confidence = 'high'
          AND item_qid NOT IN (
            SELECT DISTINCT dish_qid
            FROM `{self.dataset_ref}.dish_blacklist`
          )
        """
        
        self.execute_sql(sql)
        
        # #548 【設計】BigQuery の INSERT 結果から件数取得
        count_sql = f"""
        SELECT COUNT(*) as count
        FROM `{self.dataset_ref}.dish_blacklist`
        WHERE reason = 'llm_label'
        """
        count_result = self.execute_sql(count_sql)
        count = list(count_result)[0].count
        
        logger.info(f"Applied {count} LLM labels to dish_blacklist")
        return count
