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
import tempfile
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Any
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
    
    def execute_dml(self, sql: str) -> int:
        """
        #550 【設計】DML 文を実行する

        Args:
            sql: 実行する DML SQL 文字列

        Returns:
            影響を受けた行数
        """
        logger.info("Executing DML...")
        job = self.client.query(sql)
        job.result()
        affected = job.num_dml_affected_rows or 0
        logger.info(f"DML completed, affected_rows={affected}")
        return affected
    
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
    
    def fetch_food_roots(self) -> List[Tuple[str, str]]:
        """
        #741 【設計】food_roots テーブルから root 定義を取得
        
        Returns:
            [(root_qid, kind), ...] のリスト
        """
        logger.info("Fetching food roots from BigQuery...")
        
        sql = f"""
        SELECT root_qid, kind
        FROM `{self.dataset_ref}.food_roots`
        ORDER BY root_qid
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        food_roots = [(row.root_qid, row.kind) for row in results]
        logger.info(f"Fetched {len(food_roots)} food roots: {food_roots}")
        
        return food_roots
    
    def fetch_class_qids_from_closure(self) -> List[str]:
        """
        #745 【設計】food_class_closure テーブルから全クラス QID を取得
        
        Returns:
            クラス QID のリスト（重複なし）
        """
        logger.info("Fetching class QIDs from food_class_closure...")
        
        sql = f"""
        SELECT DISTINCT class_qid
        FROM `{self.dataset_ref}.food_class_closure`
        ORDER BY class_qid
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        class_qids = [row.class_qid for row in results]
        logger.info(f"Fetched {len(class_qids)} distinct class QIDs from closure")
        
        return class_qids
    
    def load_food_class_closure(self, classes: List[Dict]) -> None:
        """
        #745 【設計】food_class_closure テーブルにクラス閉包をロード
        
        Args:
            classes: クラス情報のリスト
                     [{'class_qid': 'Q12345', 'root_qid': 'Q746549', 'kind': 'dish', 'depth': 0}, ...]
        """
        if not classes:
            logger.warning("No classes to load")
            return
        
        table_id = f"{self.dataset_ref}.food_class_closure"
        logger.info(f"Loading {len(classes)} classes to {table_id} via Load Job")
        
        # #745 【設計】JSONL を一時ファイルに書き出し
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8') as f:
            temp_path = f.name
            for class_item in classes:
                row = {
                    "class_qid": class_item["class_qid"],
                    "root_qid": class_item["root_qid"],
                    "kind": class_item["kind"],
                    "depth": class_item["depth"],
                }
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
        
        logger.info(f"Wrote {len(classes)} classes to temp JSONL: {temp_path}")
        
        try:
            # #745 【設計】Load Job 設定（WRITE_TRUNCATE で全削除して再ロード）
            job_config = bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
                schema=[
                    bigquery.SchemaField("class_qid", "STRING", mode="REQUIRED"),
                    bigquery.SchemaField("root_qid", "STRING", mode="REQUIRED"),
                    bigquery.SchemaField("kind", "STRING", mode="REQUIRED"),
                    bigquery.SchemaField("depth", "INT64", mode="REQUIRED"),
                ]
            )
            
            # #745 【設計】Load Job 実行
            with open(temp_path, 'rb') as f:
                load_job = self.client.load_table_from_file(
                    f,
                    table_id,
                    job_config=job_config
                )
            
            load_job.result()  # Wait for completion
            logger.info(f"Load Job completed: {load_job.output_rows} rows loaded to food_class_closure")
            
        finally:
            # 一時ファイル削除
            Path(temp_path).unlink(missing_ok=True)
            logger.debug(f"Deleted temp file: {temp_path}")
    
    def load_food_nodes_to_staging(self, nodes: List[Dict]) -> None:
        """
        #741 【設計】food_nodes_raw_staging テーブルに Load Job でノードをロード
        
        Args:
            nodes: ノード情報のリスト
                   [{'item_qid': 'Q12345', 'label_ja': '寿司', ...}, ...]
        """
        if not nodes:
            logger.warning("No nodes to load to staging")
            return
        
        table_id = f"{self.dataset_ref}.food_nodes_raw_staging"
        logger.info(f"Loading {len(nodes)} nodes to staging via Load Job")
        
        # #741 【設計】JSONL を一時ファイルに書き出し
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8') as f:
            temp_path = f.name
            for node in nodes:
                row = {
                    "item_qid": node["item_qid"],
                    "label_ja": node.get("label_ja"),
                    "label_en": node.get("label_en"),
                    "desc_ja": node.get("desc_ja"),
                    "desc_en": node.get("desc_en"),
                }
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
        
        logger.info(f"Wrote {len(nodes)} nodes to temp JSONL: {temp_path}")
        
        try:
            # #741 【設計】Load Job 設定（WRITE_TRUNCATE で staging をクリア）
            job_config = bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
                schema=[
                    bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
                    bigquery.SchemaField("label_ja", "STRING"),
                    bigquery.SchemaField("label_en", "STRING"),
                    bigquery.SchemaField("desc_ja", "STRING"),
                    bigquery.SchemaField("desc_en", "STRING"),
                ]
            )
            
            # #741 【設計】Load Job 実行
            with open(temp_path, 'rb') as f:
                load_job = self.client.load_table_from_file(
                    f,
                    table_id,
                    job_config=job_config
                )
            
            load_job.result()  # Wait for completion
            logger.info(f"Load Job completed: {load_job.output_rows} rows loaded to staging")
            
        finally:
            # 一時ファイル削除
            Path(temp_path).unlink(missing_ok=True)
            logger.debug(f"Deleted temp file: {temp_path}")
    
    def merge_food_nodes_from_staging(self) -> Dict[str, int]:
        """
        #741 【設計】staging → food_nodes_raw へ MERGE（累積運用、DELETE なし）
        
        Returns:
            {"inserted": N, "updated": M} の辞書
        """
        logger.info("Merging nodes from staging to food_nodes_raw...")
        
        staging_table = f"{self.dataset_ref}.food_nodes_raw_staging"
        target_table = f"{self.dataset_ref}.food_nodes_raw"
        
        # #741 【設計】MERGE 前の件数チェック
        count_before = self._count_distinct_qids(target_table)
        logger.info(f"food_nodes_raw before MERGE: {count_before} distinct QIDs")
        
        # #741 【設計】MERGE SQL（staging 優先、staging に無いものは保持）
        sql = f"""
        MERGE `{target_table}` AS target
        USING `{staging_table}` AS source
        ON target.item_qid = source.item_qid
        WHEN MATCHED THEN
          UPDATE SET
            label_ja = source.label_ja,
            label_en = source.label_en,
            desc_ja = source.desc_ja,
            desc_en = source.desc_en
        WHEN NOT MATCHED THEN
          INSERT (item_qid, label_ja, label_en, desc_ja, desc_en)
          VALUES (source.item_qid, source.label_ja, source.label_en, source.desc_ja, source.desc_en)
        """
        
        affected_rows = self.execute_dml(sql)
        logger.info(f"MERGE completed: {affected_rows} rows affected")
        
        # #741 【設計】MERGE 後の件数チェック
        count_after = self._count_distinct_qids(target_table)
        logger.info(f"food_nodes_raw after MERGE: {count_after} distinct QIDs")
        
        # #741 【設計】新規 QID 数を計算
        new_qids = self._count_new_qids(staging_table, target_table)
        
        return {
            "before_count": count_before,
            "after_count": count_after,
            "new_qids": new_qids,
            "affected_rows": affected_rows
        }
    
    def _count_distinct_qids(self, table_id: str) -> int:
        """
        #741 【設計】テーブルの DISTINCT item_qid 件数を取得
        
        Args:
            table_id: テーブルID（完全修飾名）
            
        Returns:
            DISTINCT item_qid の件数
        """
        sql = f"SELECT COUNT(DISTINCT item_qid) AS cnt FROM `{table_id}`"
        query_job = self.client.query(sql)
        result = query_job.result()
        row = next(result)
        return row.cnt
    
    def _count_new_qids(self, staging_table: str, target_table: str) -> int:
        """
        #741 【設計】staging にあって target に無い QID の件数を取得
        
        Args:
            staging_table: staging テーブルID
            target_table: target テーブルID
            
        Returns:
            新規 QID 数
        """
        sql = f"""
        SELECT COUNT(DISTINCT s.item_qid) AS cnt
        FROM `{staging_table}` s
        LEFT JOIN `{target_table}` t
          ON s.item_qid = t.item_qid
        WHERE t.item_qid IS NULL
        """
        query_job = self.client.query(sql)
        result = query_job.result()
        row = next(result)
        return row.cnt
    
    def iter_new_qids_in_staging(self):
        """
        #741 【設計】staging にあって raw に無い QID を逐次 yield するジェネレータ
        
        MERGE 前に「今回新規に入るQID」を抽出し、ファイル保存等に使う。
        メモリ圧迫を避けるため generator で返す。
        
        Yields:
            item_qid (str): 新規 QID
        """
        staging_table = f"{self.dataset_ref}.food_nodes_raw_staging"
        target_table = f"{self.dataset_ref}.food_nodes_raw"
        
        sql = f"""
        SELECT DISTINCT s.item_qid
        FROM `{staging_table}` s
        LEFT JOIN `{target_table}` r
          ON r.item_qid = s.item_qid
        WHERE NOT EXISTS (
          SELECT 1 FROM `raw` r WHERE r.item_qid = s.item_qid
        );
        """
        
        query_job = self.client.query(sql)
        result = query_job.result()
        
        for row in result:
            yield row.item_qid
    
    def get_staging_summary(self) -> Dict[str, Any]:
        """
        #741 【設計】staging の統計情報を取得（観測性向上）
        
        Returns:
            統計情報の辞書
        """
        staging_table = f"{self.dataset_ref}.food_nodes_raw_staging"
        
        sql = f"""
        SELECT
          COUNT(DISTINCT item_qid) AS distinct_qids,
          COUNT(*) AS total_rows,
          COUNTIF(label_ja IS NULL) AS label_ja_null,
          COUNTIF(label_en IS NULL) AS label_en_null,
          COUNTIF(desc_ja IS NULL) AS desc_ja_null,
          COUNTIF(desc_en IS NULL) AS desc_en_null
        FROM `{staging_table}`
        """
        
        query_job = self.client.query(sql)
        result = query_job.result()
        row = next(result)
        
        summary = {
            "distinct_qids": row.distinct_qids,
            "total_rows": row.total_rows,
            "label_ja_null": row.label_ja_null,
            "label_en_null": row.label_en_null,
            "desc_ja_null": row.desc_ja_null,
            "desc_en_null": row.desc_en_null,
        }
        
        # #741 【設計】欠損率を計算
        if summary["total_rows"] > 0:
            summary["label_ja_null_rate"] = summary["label_ja_null"] / summary["total_rows"]
            summary["label_en_null_rate"] = summary["label_en_null"] / summary["total_rows"]
        
        return summary
    
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
        WITH joined AS (
          -- dish × root × depth の生データ
          SELECT
            fp.child_qid AS dish_qid,
            fr.root_qid AS root_qid,
            fr.kind     AS kind,
            fp.depth    AS depth
          FROM `{self.dataset_ref}.food_paths` fp
          JOIN `{self.dataset_ref}.food_roots` fr
            ON fp.ancestor_qid = fr.root_qid
        ),
        per_root AS (
          -- dish × root ごとに「最短 depth」を 1 回だけ集約
          SELECT
            dish_qid,
            root_qid,
            kind,
            MIN(depth) AS min_depth
          FROM joined
          GROUP BY
            dish_qid,
            root_qid,
            kind
        )
        SELECT
          dish_qid,
          ARRAY_AGG(
            STRUCT(
              root_qid,
              kind,
              min_depth
            )
            ORDER BY min_depth, root_qid
          ) AS roots
        FROM per_root
        GROUP BY dish_qid
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
    
    def fetch_all_node_qids(self) -> List[str]:
        """
        food_nodes_raw から全ノード QID を取得
        
        Returns:
            ノード QID のリスト
        """
        logger.info("Fetching all node QIDs from food_nodes_raw...")
        
        sql = f"""
        SELECT DISTINCT item_qid
        FROM `{self.dataset_ref}.food_nodes_raw`
        ORDER BY item_qid
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        node_qids = [row.item_qid for row in results]
        logger.info(f"Fetched {len(node_qids)} node QIDs")
        
        return node_qids
    
    def load_food_edges_raw(self, edges: List[Tuple[str, str]]) -> None:
        """
        food_edges_raw テーブルにエッジデータをロード
        
        Args:
            edges: (child_qid, parent_qid) のタプルのリスト
        """
        if not edges:
            logger.warning("No edges to load")
            return
        
        table_id = f"{self.dataset_ref}.food_edges_raw"
        logger.info(f"Loading {len(edges)} edges to {table_id}")
        
        # #550 【設計】既存データを削除して再ロード
        try:
            self.execute_sql(f"TRUNCATE TABLE `{table_id}`")
            logger.info(f"Truncated {table_id}")
        except Exception as e:
            logger.warning(f"Failed to truncate {table_id}: {e}")
        
        # #550 【設計】エッジデータをロード（既存の fetch_parent_edges は P31/P279 を区別しない）
        rows_to_insert = [
            {
                "child_qid": child,
                "parent_qid": parent
            }
            for child, parent in edges
        ]
        
        # バッチでインサート（BigQuery の制限対策）
        batch_size = 10000
        for i in range(0, len(rows_to_insert), batch_size):
            batch = rows_to_insert[i:i + batch_size]
            errors = self.client.insert_rows_json(table_id, batch)
            if errors:
                logger.error(f"Errors occurred while loading edges: {errors}")
                raise Exception(f"Failed to load edges: {errors}")
            logger.info(f"Loaded batch {i // batch_size + 1}/{(len(rows_to_insert) + batch_size - 1) // batch_size}")
        
        logger.info(f"Successfully loaded {len(edges)} edges")
    
    def generate_dish_category_catalog(self) -> None:
        """
        dish_category_catalog テーブルを生成
        blacklist を除外し、labels/desc/tags を付与
        """
        table_id = f"{self.dataset_ref}.dish_category_catalog"
        logger.info(f"Generating dish_category_catalog table")
        
        # #550 【設計】CREATE OR REPLACE で再生成可能にする
        sql = f"""
        CREATE OR REPLACE TABLE `{table_id}` AS
        WITH non_blacklisted AS (
          -- blacklist に含まれていない dish を抽出
          SELECT
            n.item_qid,
            n.label_ja,
            n.label_en,
            n.desc_ja,
            n.desc_en
          FROM `{self.dataset_ref}.food_nodes_raw` n
          LEFT JOIN `{self.dataset_ref}.dish_blacklist` b
            ON n.item_qid = b.dish_qid
          WHERE b.dish_qid IS NULL
        ),
        tags_aggregated AS (
          -- depth<=5 の祖先を tags として集約
          SELECT
            fp.child_qid AS item_qid,
            ARRAY_AGG(DISTINCT fp.ancestor_qid ORDER BY fp.ancestor_qid) AS tags
          FROM `{self.dataset_ref}.food_paths` fp
          WHERE fp.depth <= 5
            AND fp.depth > 0  -- #550 【設計】自分自身 (depth=0) は除外
          GROUP BY fp.child_qid
        )
        SELECT
          nb.item_qid,
          nb.label_ja,
          nb.label_en,
          nb.desc_ja,
          nb.desc_en,
          NULL AS image_url,  -- #550 【設計】image_url は今回スコープ外
          COALESCE(ta.tags, []) AS tags
        FROM non_blacklisted nb
        LEFT JOIN tags_aggregated ta
          ON nb.item_qid = ta.item_qid
        """
        
        self.execute_sql(sql)
        logger.info("Successfully generated dish_category_catalog")
    
    def generate_dish_macro_genre_analysis(self, max_candidates: int = 10) -> None:
        """
        dish_macro_genre_analysis テーブルを生成
        macro_genre_whitelist と food_paths を用いて macro_genre を決定
        
        Args:
            max_candidates: 候補の最大数（デフォルト 10）
        """
        table_id = f"{self.dataset_ref}.dish_macro_genre_analysis"
        logger.info(f"Generating dish_macro_genre_analysis table (max_candidates={max_candidates})")
        
        # #550 【設計】CREATE OR REPLACE で再生成可能にする
        sql = f"""
        CREATE OR REPLACE TABLE `{table_id}` AS
        WITH catalog_items AS (
          -- catalog に含まれる item のみを対象
          SELECT item_qid
          FROM `{self.dataset_ref}.dish_category_catalog`
        ),
        whitelist_matches AS (
          -- whitelist に含まれる祖先を持つ item を抽出
          SELECT
            fp.child_qid AS item_qid,
            fp.ancestor_qid,
            fp.depth
          FROM `{self.dataset_ref}.food_paths` fp
          INNER JOIN `{self.dataset_ref}.macro_genre_whitelist` w
            ON fp.ancestor_qid = w.item_qid
          INNER JOIN catalog_items ci
            ON fp.child_qid = ci.item_qid
        ),
        min_depth_per_item AS (
          -- 各 item の最小 depth を求める
          SELECT
            item_qid,
            MIN(depth) AS min_depth
          FROM whitelist_matches
          GROUP BY item_qid
        ),
        min_depth_candidates AS (
          -- min_depth の候補を全件抽出
          SELECT
            wm.item_qid,
            wm.ancestor_qid,
            wm.depth
          FROM whitelist_matches wm
          INNER JOIN min_depth_per_item md
            ON wm.item_qid = md.item_qid
            AND wm.depth = md.min_depth
        ),
        all_candidates AS (
          -- min_depth 全件 + 最大 K 件を取得
          SELECT
            wm.item_qid,
            wm.ancestor_qid,
            wm.depth,
            ROW_NUMBER() OVER (PARTITION BY wm.item_qid ORDER BY wm.depth, wm.ancestor_qid) AS rn
          FROM whitelist_matches wm
        ),
        candidates_limited AS (
          SELECT
            item_qid,
            ancestor_qid,
            depth
          FROM all_candidates
          WHERE rn <= {max_candidates}
        ),
        macro_genre_decision AS (
          -- macro_genre_qid の決定（min_depth が 1 件なら確定、複数なら NULL）
          SELECT
            md.item_qid,
            md.min_depth AS macro_genre_depth,
            CASE
              WHEN COUNT(DISTINCT mdc.ancestor_qid) = 1 THEN MIN(mdc.ancestor_qid)
              ELSE NULL
            END AS macro_genre_qid,
            CASE
              WHEN COUNT(DISTINCT mdc.ancestor_qid) > 1 THEN TRUE
              ELSE FALSE
            END AS macro_genre_ambiguous
          FROM min_depth_per_item md
          LEFT JOIN min_depth_candidates mdc
            ON md.item_qid = mdc.item_qid
          GROUP BY md.item_qid, md.min_depth
        ),
        candidates_array AS (
          -- 候補を配列化
          SELECT
            item_qid,
            ARRAY_AGG(
              STRUCT(ancestor_qid, depth)
              ORDER BY depth, ancestor_qid
            ) AS macro_genre_candidates
          FROM candidates_limited
          GROUP BY item_qid
        )
        SELECT
          ci.item_qid,
          COALESCE(mgd.macro_genre_qid, NULL) AS macro_genre_qid,
          mgd.macro_genre_depth,
          COALESCE(mgd.macro_genre_ambiguous, FALSE) AS macro_genre_ambiguous,
          COALESCE(ca.macro_genre_candidates, []) AS macro_genre_candidates,
          CURRENT_TIMESTAMP() AS computed_at
        FROM catalog_items ci
        LEFT JOIN macro_genre_decision mgd
          ON ci.item_qid = mgd.item_qid
        LEFT JOIN candidates_array ca
          ON ci.item_qid = ca.item_qid
        """
        
        self.execute_sql(sql)
        logger.info("Successfully generated dish_macro_genre_analysis")
    
    def fetch_macro_genre_candidate_stats(self, top_n: int = 1000) -> List[Dict]:
        """
        macro_genre 候補の統計情報を取得
        
        Args:
            top_n: 上位 N 件を取得（デフォルト 1000）
            
        Returns:
            統計情報のリスト
        """
        logger.info(f"Fetching macro_genre candidate stats (top {top_n})...")
        
        sql = f"""
        WITH catalog_items AS (
          SELECT item_qid
          FROM `{self.dataset_ref}.dish_category_catalog`
        ),
        ancestor_counts AS (
          SELECT
            fp.ancestor_qid,
            COUNT(DISTINCT fp.child_qid) AS hit_count
          FROM `{self.dataset_ref}.food_paths` fp
          INNER JOIN catalog_items ci
            ON fp.child_qid = ci.item_qid
          WHERE fp.depth > 0  -- #550 【設計】自分自身は除外
          GROUP BY fp.ancestor_qid
        ),
        examples AS (
          SELECT
            fp.ancestor_qid,
            ARRAY_AGG(
              STRUCT(
                fp.child_qid AS qid,
                n.label_ja,
                n.label_en
              )
              LIMIT 5
            ) AS example_items
          FROM `{self.dataset_ref}.food_paths` fp
          INNER JOIN catalog_items ci
            ON fp.child_qid = ci.item_qid
          LEFT JOIN `{self.dataset_ref}.food_nodes_raw` n
            ON fp.child_qid = n.item_qid
          WHERE fp.depth > 0
          GROUP BY fp.ancestor_qid
        )
        SELECT
          ac.ancestor_qid,
          n.label_ja,
          n.label_en,
          ac.hit_count,
          TO_JSON_STRING(ex.example_items) AS example_items
        FROM ancestor_counts ac
        LEFT JOIN `{self.dataset_ref}.food_nodes_raw` n
          ON ac.ancestor_qid = n.item_qid
        LEFT JOIN examples ex
          ON ac.ancestor_qid = ex.ancestor_qid
        ORDER BY ac.hit_count DESC
        LIMIT {top_n}
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        stats = [
            {
                "ancestor_qid": row.ancestor_qid,
                "label_ja": row.label_ja or "",
                "label_en": row.label_en or "",
                "hit_count": row.hit_count,
                "example_items": row.example_items or "[]"
            }
            for row in results
        ]
        
        logger.info(f"Fetched {len(stats)} candidate stats")
        return stats
    
    def fetch_macro_genre_review_data(
        self,
        ambiguous_only: bool = False,
        null_only: bool = False
    ) -> List[Dict]:
        """
        macro_genre レビュー用データを取得
        
        Args:
            ambiguous_only: 曖昧なものだけ取得
            null_only: NULL のものだけ取得
            
        Returns:
            レビューデータのリスト
        """
        logger.info("Fetching macro_genre review data...")
        
        where_clauses = []
        if ambiguous_only:
            where_clauses.append("a.macro_genre_ambiguous = TRUE")
        if null_only:
            where_clauses.append("a.macro_genre_qid IS NULL")
        
        where_clause = ""
        if where_clauses:
            where_clause = "WHERE " + " AND ".join(where_clauses)
        
        sql = f"""
        SELECT
          c.item_qid,
          c.label_ja,
          c.label_en,
          a.macro_genre_qid,
          a.macro_genre_depth,
          a.macro_genre_ambiguous,
          TO_JSON_STRING(a.macro_genre_candidates) AS macro_genre_candidates,
          TO_JSON_STRING(c.tags) AS tags
        FROM `{self.dataset_ref}.dish_category_catalog` c
        LEFT JOIN `{self.dataset_ref}.dish_macro_genre_analysis` a
          ON c.item_qid = a.item_qid
        {where_clause}
        ORDER BY c.item_qid
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        review_data = [
            {
                "item_qid": row.item_qid,
                "label_ja": row.label_ja or "",
                "label_en": row.label_en or "",
                "macro_genre_qid": row.macro_genre_qid or "",
                "macro_genre_depth": row.macro_genre_depth if row.macro_genre_depth is not None else "",
                "macro_genre_ambiguous": row.macro_genre_ambiguous if row.macro_genre_ambiguous is not None else False,
                "macro_genre_candidates": row.macro_genre_candidates or "[]",
                "tags": row.tags or "[]"
            }
            for row in results
        ]
        
        logger.info(f"Fetched {len(review_data)} review items")
        return review_data
    
    def get_all_dishes_for_macro_genre_labeling(self) -> List[Dict]:
        """
        #550 【設計】macro_genre LLM ラベリング用に全 dish を取得
        dish_blacklist 未該当の全アイテム（macro_genre 付与済み含む）
        
        Returns:
            dish リスト [{'item_qid': 'Q...', 'label_en': '...', 'desc_en': '...'}, ...]
        """
        logger.info("Fetching all dishes for macro_genre labeling from BigQuery...")
        
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
        ORDER BY fnr.item_qid
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        dishes = [
            {
                "item_qid": row.item_qid,
                "label_en": row.label_en,
                "desc_en": row.desc_en
            }
            for row in results
        ]
        
        logger.info(f"Found {len(dishes)} dishes for macro_genre labeling")
        return dishes
    
    def load_macro_genre_llm_labels(
        self,
        labels: List[Dict],
        task: str,
        model: str,
        run_id: str
    ) -> None:
        """
        #550 【設計】wikidata_food_llm_labels テーブルに macro_genre LLM ラベリング結果をロード
        
        Args:
            labels: ラベル情報のリスト
                    [{'item_qid': 'Q12345', 'decision': 'C', 'confidence': 'high', 
                      'macro_genre': 'Ramen', 'reason': '...'}, ...]
            task: タスク識別子（例: '#550_macro_genre_abc_classification'）
            model: モデル名（例: 'gpt-4.1-mini'）
            run_id: バッチ実行ごとの識別子（例: '20251217T0000_v1'）
        """
        if not labels:
            logger.warning("No labels to load")
            return
        
        table_id = f"{self.dataset_ref}.wikidata_food_llm_labels"
        logger.info(f"Loading {len(labels)} macro_genre labels to {table_id}")
        
        # #550 【設計】データを準備（decision/macro_genre を label カラムに格納）
        current_time = datetime.now(timezone.utc).isoformat()
        rows_to_insert = []
        
        for label in labels:
            # decision を label カラムに保存
            # macro_genre は reason に JSON 形式で埋め込む
            decision = label.get("decision")
            macro_genre = label.get("macro_genre")
            reason = label.get("reason")
            
            # #550 【設計】reason に macro_genre を埋め込む形式: "reason_text | macro_genre: Genre"
            full_reason = reason
            if decision == "C" and macro_genre:
                full_reason = f"{reason} | macro_genre: {macro_genre}"
            
            rows_to_insert.append({
                "item_qid": label["item_qid"],
                "task": task,
                "label": decision,  # A/B/C を label カラムに保存
                "confidence": label["confidence"],
                "reason": full_reason,
                "model": model,
                "run_id": run_id,
                "created_at": current_time
            })
        
        # #550 【設計】BigQuery に INSERT（エラー時は失敗した item_qid をログに記録）
        errors = self.client.insert_rows_json(table_id, rows_to_insert)
        
        if errors:
            # #550 【バグ】エラーの詳細をログに記録（index フィールドで失敗した行を特定）
            failed_qids = [
                rows_to_insert[err.get('index', -1)]["item_qid"] 
                for err in errors 
                if 'index' in err and err['index'] < len(rows_to_insert)
            ]
            logger.error(f"Errors occurred while inserting rows: {errors}")
            logger.error(f"Failed item_qids (sample): {failed_qids[:10]}")
            raise Exception(f"Failed to insert rows: {errors}")
        
        logger.info(f"Successfully loaded {len(labels)} macro_genre labels")
    
    def get_macro_genre_llm_label_stats(self, task: str, run_id: str = None) -> Dict:
        """
        #550 【設計】wikidata_food_llm_labels の統計情報を取得（macro_genre 用）
        
        Args:
            task: タスク識別子（例: '#550_macro_genre_abc_classification'）
            run_id: 特定の run_id に絞る場合に指定
            
        Returns:
            統計情報の辞書
        """
        logger.info(f"Fetching macro_genre LLM label statistics for task={task}...")
        
        where_clauses = [f"task = '{task}'"]
        if run_id:
            where_clauses.append(f"run_id = '{run_id}'")
        where_clause = " AND ".join(where_clauses)
        
        sql = f"""
        SELECT
          label,
          confidence,
          COUNT(*) as count
        FROM `{self.dataset_ref}.wikidata_food_llm_labels`
        WHERE {where_clause}
        GROUP BY label, confidence
        ORDER BY label, confidence
        """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        stats = {}
        for row in results:
            key = f"{row.label}_{row.confidence}"
            stats[key] = row.count
        
        logger.info(f"Statistics: {stats}")
        return stats
    
    def apply_macro_genre_llm_labels_to_blacklist(self, task: str, run_id: str) -> int:
        """
        #550 【設計】wikidata_food_llm_labels から dish_blacklist を更新（decision=A）
        
        Args:
            task: タスク識別子（例: '#550_macro_genre_abc_classification'）
            run_id: 適用する run_id
            
        Returns:
            追加された行数
        """
        logger.info(f"Applying macro_genre LLM labels (decision=A) from run_id={run_id} to dish_blacklist...")
        
        sql = f"""
        INSERT INTO `{self.dataset_ref}.dish_blacklist` (
          dish_qid,
          reason,
          note,
          created_at
        )
        SELECT
          item_qid AS dish_qid,
          'llm_macro_genre' AS reason,
          CONCAT('decision=', label, ', ', reason) AS note,
          CURRENT_TIMESTAMP() AS created_at
        FROM `{self.dataset_ref}.wikidata_food_llm_labels`
        WHERE
          task = '{task}'
          AND run_id = '{run_id}'
          AND label = 'A'  -- #550 【設計】decision=A（blacklist）のみ自動反映
          AND confidence = 'high'  -- #550 【設計】高信頼度のみ自動反映（medium/low は手動レビュー）
          AND item_qid NOT IN (  -- #550 【設計】重複防止：既に blacklist に存在するものは除外
            SELECT DISTINCT dish_qid
            FROM `{self.dataset_ref}.dish_blacklist`
          )
        """
        
        affected = self.execute_dml(sql)
        logger.info(f"Applied {affected} macro_genre LLM labels (decision=A) to dish_blacklist (run_id={run_id})")
        return affected
    
    def get_region_label_targets(self, market: str) -> List[Dict]:
        """
        #557 【設計】region gate LLM ラベリング用に dish_category_catalog から対象を取得
        image_url IS NOT NULL のもののみ（画像がないとアプリ側で出せないため）
        
        Args:
            market: market キー（'scope:global' or 'country:JP'）
        
        Returns:
            dish リスト [{'item_qid': 'Q...', 'label_en': '...', 'desc_en': '...', ...}, ...]
        """
        logger.info(f"Fetching region label targets for market={market} from BigQuery...")
        
        # #557 【設計】market に応じて日本語情報の有無を考慮
        if market == "country:JP":
            sql = f"""
            SELECT
              item_qid,
              label_en,
              label_ja,
              desc_en,
              desc_ja,
              labels_json,
              descriptions_json,
              aliases_json,
              sitelinks_json,
              origin_qids,
              cuisine_qids,
              roots,
              tags
            FROM `{self.dataset_ref}.dish_category_catalog`
            WHERE image_url IS NOT NULL
              -- #557 【備考】・country:JP では、 label_ja IS NOT NULL に絞る。
              -- spaghetti bolognese 等一部漏れるが、誤差の範囲とする。
              AND label_ja IS NOT NULL
            ORDER BY item_qid
            """
        else:
            sql = f"""
            SELECT
              item_qid,
              label_en,
              desc_en,
              labels_json,
              descriptions_json,
              aliases_json,
              sitelinks_json,
              origin_qids,
              cuisine_qids,
              roots,
              tags
            FROM `{self.dataset_ref}.dish_category_catalog`
            WHERE image_url IS NOT NULL
            ORDER BY item_qid
            """
        
        query_job = self.client.query(sql)
        results = query_job.result()
        
        items = []
        for row in results:
            item = {
                "item_qid": row.item_qid,
                "label_en": row.label_en,
                "desc_en": row.desc_en,
                "labels_json": row.labels_json,
                "descriptions_json": row.descriptions_json,
                "aliases_json": row.aliases_json,
                "sitelinks_json": row.sitelinks_json,
                "origin_qids": row.origin_qids,
                "cuisine_qids": row.cuisine_qids,
                "roots": row.roots,
                "tags": row.tags
            }
            if market == "country:JP":
                item["label_ja"] = row.label_ja
                item["desc_ja"] = row.desc_ja
            items.append(item)
        
        logger.info(f"Found {len(items)} items for market={market}")
        return items
    
    def load_region_gate_llm_labels(
        self,
        labels: List[Dict],
        task: str,
        model: str,
        run_id: str
    ) -> None:
        """
        #557 【設計】wikidata_food_llm_labels テーブルに region gate LLM ラベリング結果をロード
        
        Args:
            labels: ラベル情報のリスト
                    [{'item_qid': 'Q12345', 'decision': 'allow', 'confidence': 'high', 
                      'reason': '...'}, ...]
            task: タスク識別子（例: '#557_region_scope_global'）
            model: モデル名（例: 'gpt-4o-mini'）
            run_id: バッチ実行ごとの識別子（例: '20251218T0000_global_v1'）
        """
        if not labels:
            logger.warning("No labels to load")
            return
        
        table_id = f"{self.dataset_ref}.wikidata_food_llm_labels"
        logger.info(f"Loading {len(labels)} region gate labels to {table_id}")
        
        # #557 【設計】データを準備（decision を label カラムに格納）
        now = datetime.now(timezone.utc)
        rows_to_insert = [
            {
                "item_qid": label["item_qid"],
                "task": task,
                "label": label["decision"],  # allow/deny/uncertain
                "confidence": label["confidence"],
                "reason": label.get("reason", ""),
                "model": model,
                "run_id": run_id,
                "created_at": now.isoformat()
            }
            for label in labels
        ]
        
        errors = self.client.insert_rows_json(table_id, rows_to_insert)
        
        if errors:
            logger.error(f"Errors occurred while loading labels: {errors}")
            raise Exception(f"Failed to load labels: {errors}")
        
        logger.info(f"Successfully loaded {len(labels)} region gate labels")
    
    def apply_region_gate_features(
        self,
        task: str,
        run_id: str,
        market: str,
        dry_run: bool = False
    ) -> int:
        """
        #557 【設計】region gate LLM ラベリング結果を dish_category_features_catalog に MERGE 反映
        allow & confidence=high のみ自動反映（Precision 最優先のホワイトリスト運用）
        
        Args:
            task: タスク識別子（例: '#557_region_scope_global'）
            run_id: バッチ実行ごとの識別子
            market: market キー（'scope:global' or 'country:JP'）
            dry_run: True の場合、実際には反映しない
        
        Returns:
            影響を受けた行数
        """
        logger.info(f"Applying region gate features (task={task}, run_id={run_id}, market={market}, dry_run={dry_run})")
        
        feature_key = f"region:{market}"
        
        if dry_run:
            # #557 【設計】dry-run では件数のみ確認
            sql = f"""
            SELECT COUNT(*) as count
            FROM `{self.dataset_ref}.wikidata_food_llm_labels`
            WHERE task = '{task}'
              AND run_id = '{run_id}'
              AND label = 'allow'
              AND confidence = 'high'
            """
            query_job = self.client.query(sql)
            results = query_job.result()
            count = list(results)[0].count
            logger.info(f"[DRY-RUN] Would apply {count} region gate features")
            return count
        
        # #557 【設計】MERGE で反映（過分削除含む）
        now = datetime.now(timezone.utc)
        sql = f"""
        MERGE `{self.dataset_ref}.dish_category_features_catalog` AS target
        USING (
          SELECT
            item_qid,
            '{feature_key}' AS feature_key,
            1.0 AS score,
            'llm' AS source,
            '{run_id}' AS run_id,
            TIMESTAMP('{now.isoformat()}') AS updated_at,
            CONCAT('confidence=', confidence, ' | ', reason) AS note
          FROM `{self.dataset_ref}.wikidata_food_llm_labels`
          WHERE task = '{task}'
            AND run_id = '{run_id}'
            AND label = 'allow'
            AND confidence = 'high'
        ) AS source
        ON target.item_qid = source.item_qid
          AND target.feature_type = 'gate'
          AND target.feature_key = source.feature_key
          AND target.run_id = source.run_id
        WHEN MATCHED THEN
          UPDATE SET
            score = source.score,
            source = source.source,
            updated_at = source.updated_at,
            note = source.note
        WHEN NOT MATCHED THEN
          INSERT (item_qid, feature_type, feature_key, score, source, run_id, updated_at, note)
          VALUES (source.item_qid, 'gate', source.feature_key, source.score, source.source, source.run_id, source.updated_at, source.note)
        """
        
        affected = self.execute_dml(sql)
        logger.info(f"Applied {affected} region gate features (run_id={run_id}, market={market})")
        
        # #557 【設計】過分削除：同一 run_id / market / feature_key で今回 allow/high に含まれないものを削除
        delete_sql = f"""
        DELETE FROM `{self.dataset_ref}.dish_category_features_catalog`
        WHERE feature_type = 'gate'
          AND feature_key = '{feature_key}'
          AND run_id = '{run_id}'
          AND item_qid NOT IN (
            SELECT item_qid
            FROM `{self.dataset_ref}.wikidata_food_llm_labels`
            WHERE task = '{task}'
              AND run_id = '{run_id}'
              AND label = 'allow'
              AND confidence = 'high'
          )
        """
        
        deleted = self.execute_dml(delete_sql)
        logger.info(f"Deleted {deleted} obsolete region gate features (run_id={run_id}, market={market})")
        
        return affected
