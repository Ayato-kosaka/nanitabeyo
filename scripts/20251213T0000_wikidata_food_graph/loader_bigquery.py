#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loader_bigquery.py

【目的】
BigQuery へのデータロードと処理ロジック

【機能】
- テーブル作成（migration SQL の実行）
- ノードデータのロード
- food_paths の生成（recursive CTE）
- dish_root_summary の生成
- dish_blacklist の自動生成
"""

import logging
from typing import List, Dict, Tuple
from google.cloud import bigquery
from google.cloud.exceptions import NotFound

logger = logging.getLogger(__name__)


class BigQueryLoader:
    """BigQuery へのデータロードと処理を管理するクラス"""
    
    def __init__(self, project_id: str, dataset_id: str):
        self.client = bigquery.Client(project=project_id)
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.dataset_ref = f"{project_id}.{dataset_id}"
    
    def execute_sql(self, sql: str) -> None:
        """
        SQL を実行する
        
        Args:
            sql: 実行する SQL 文字列
        """
        logger.info(f"Executing SQL...")
        job = self.client.query(sql)
        job.result()  # Wait for completion
        logger.info(f"SQL execution completed")
    
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
    
    def load_food_nodes(self, nodes: List[Dict]) -> None:
        """
        food_nodes_raw テーブルにノードデータをロード
        
        Args:
            nodes: ノード情報のリスト
                   [{'item_qid': 'Q12345', 'label_ja': '寿司', ...}, ...]
        """
        if not nodes:
            logger.warning("No nodes to load")
            return
        
        table_id = f"{self.dataset_ref}.food_nodes_raw"
        logger.info(f"Loading {len(nodes)} nodes to {table_id}")
        
        # テーブルが存在するか確認
        try:
            self.client.get_table(table_id)
            # テーブルが存在する場合、既存データを削除
            logger.info(f"Table {table_id} exists, truncating...")
            self.execute_sql(f"TRUNCATE TABLE `{table_id}`")
        except NotFound:
            logger.warning(f"Table {table_id} not found, skipping truncate")
        
        # データをロード
        rows_to_insert = [
            {
                "item_qid": node["item_qid"],
                "label_ja": node.get("label_ja"),
                "label_en": node.get("label_en"),
                "desc_ja": node.get("desc_ja"),
                "desc_en": node.get("desc_en"),
            }
            for node in nodes
        ]
        
        errors = self.client.insert_rows_json(table_id, rows_to_insert)
        
        if errors:
            logger.error(f"Errors occurred while loading nodes: {errors}")
            raise Exception(f"Failed to load nodes: {errors}")
        
        logger.info(f"Successfully loaded {len(nodes)} nodes")
    
    def generate_food_paths(self, edges: List[Tuple[str, str]], max_depth: int = 20) -> None:
        """
        food_paths テーブルを生成（recursive CTE を使用）
        
        Args:
            edges: (child_qid, parent_qid) のタプルのリスト
            max_depth: 再帰の最大深度
        """
        table_id = f"{self.dataset_ref}.food_paths"
        logger.info(f"Generating food_paths table with max_depth={max_depth}")
        
        if not edges:
            logger.warning("No edges to process")
            return
        
        # まず、エッジデータを一時テーブルに入れる
        temp_table_id = f"{self.dataset_ref}.temp_food_edges"
        
        # 既存の一時テーブルを削除
        try:
            self.client.delete_table(temp_table_id)
            logger.info(f"Deleted existing temp table: {temp_table_id}")
        except NotFound:
            pass
        
        # 一時テーブルを作成
        schema = [
            bigquery.SchemaField("child_qid", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("parent_qid", "STRING", mode="REQUIRED"),
        ]
        temp_table = bigquery.Table(temp_table_id, schema=schema)
        self.client.create_table(temp_table)
        logger.info(f"Created temp table: {temp_table_id}")
        
        # エッジデータをロード
        rows_to_insert = [
            {"child_qid": child, "parent_qid": parent}
            for child, parent in edges
        ]
        
        # バッチでインサート（BigQuery の制限対策）
        batch_size = 10000
        for i in range(0, len(rows_to_insert), batch_size):
            batch = rows_to_insert[i:i + batch_size]
            errors = self.client.insert_rows_json(temp_table_id, batch)
            if errors:
                logger.error(f"Errors occurred while loading edges: {errors}")
                raise Exception(f"Failed to load edges: {errors}")
            logger.info(f"Loaded batch {i // batch_size + 1}/{(len(rows_to_insert) + batch_size - 1) // batch_size}")
        
        logger.info(f"Loaded {len(edges)} edges to temp table")
        
        # food_paths を TRUNCATE
        try:
            self.execute_sql(f"TRUNCATE TABLE `{table_id}`")
            logger.info(f"Truncated {table_id}")
        except Exception as e:
            logger.warning(f"Failed to truncate {table_id}: {e}")
        
        # recursive CTE で food_paths を生成
        sql = f"""
        INSERT INTO `{table_id}` (child_qid, ancestor_qid, depth)
        WITH RECURSIVE paths AS (
          -- Base case: 自分自身 (depth = 0)
          SELECT DISTINCT
            child_qid,
            child_qid AS ancestor_qid,
            0 AS depth
          FROM `{temp_table_id}`
          
          UNION ALL
          
          -- Recursive case: 親を辿る (depth + 1)
          SELECT
            p.child_qid,
            e.parent_qid AS ancestor_qid,
            p.depth + 1 AS depth
          FROM paths p
          JOIN `{temp_table_id}` e
            ON p.ancestor_qid = e.child_qid
          WHERE p.depth < {max_depth}
        )
        SELECT DISTINCT
          child_qid,
          ancestor_qid,
          MIN(depth) AS depth
        FROM paths
        GROUP BY child_qid, ancestor_qid
        """
        
        self.execute_sql(sql)
        logger.info("Successfully generated food_paths")
        
        # 一時テーブルを削除
        self.client.delete_table(temp_table_id)
        logger.info(f"Deleted temp table: {temp_table_id}")
    
    def generate_dish_root_summary(self) -> None:
        """
        dish_root_summary テーブルを生成
        food_paths と food_roots を JOIN して、各 dish がどの root にぶら下がっているかを集約
        """
        table_id = f"{self.dataset_ref}.dish_root_summary"
        logger.info(f"Generating dish_root_summary table")
        
        # TRUNCATE
        try:
            self.execute_sql(f"TRUNCATE TABLE `{table_id}`")
        except Exception as e:
            logger.warning(f"Failed to truncate {table_id}: {e}")
        
        sql = f"""
        INSERT INTO `{table_id}` (dish_qid, roots)
        SELECT
          fp.child_qid AS dish_qid,
          ARRAY_AGG(
            STRUCT(
              fr.root_qid AS root_qid,
              fr.kind AS kind,
              MIN(fp.depth) AS min_depth
            )
          ) AS roots
        FROM `{self.dataset_ref}.food_paths` fp
        JOIN `{self.dataset_ref}.food_roots` fr
          ON fp.ancestor_qid = fr.root_qid
        GROUP BY fp.child_qid
        """
        
        self.execute_sql(sql)
        logger.info("Successfully generated dish_root_summary")
    
    def generate_dish_blacklist_from_ancestors(self) -> None:
        """
        dish_blacklist テーブルを自動生成
        dish_ancestor_blacklist に含まれる ancestor_qid を持つ dish を抽出し、
        reason='ancestor' として dish_blacklist に INSERT
        """
        table_id = f"{self.dataset_ref}.dish_blacklist"
        logger.info(f"Generating dish_blacklist from ancestors")
        
        # reason='ancestor' のレコードを削除（既存のものをクリア）
        try:
            self.execute_sql(f"""
                DELETE FROM `{table_id}`
                WHERE reason = 'ancestor'
            """)
            logger.info("Deleted existing ancestor-based blacklist entries")
        except Exception as e:
            logger.warning(f"Failed to delete existing entries: {e}")
        
        sql = f"""
        INSERT INTO `{table_id}` (dish_qid, reason, note, created_at)
        SELECT DISTINCT
          fp.child_qid AS dish_qid,
          'ancestor' AS reason,
          CONCAT('blacklisted by ancestor: ', dab.ancestor_qid, ' (', dab.reason, ')') AS note,
          CURRENT_TIMESTAMP() AS created_at
        FROM `{self.dataset_ref}.food_paths` fp
        JOIN `{self.dataset_ref}.dish_ancestor_blacklist` dab
          ON fp.ancestor_qid = dab.ancestor_qid
        """
        
        self.execute_sql(sql)
        logger.info("Successfully generated dish_blacklist from ancestors")
