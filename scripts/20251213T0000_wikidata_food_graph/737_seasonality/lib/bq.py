#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bq.py

【目的】
BigQuery 操作ライブラリ（#737 seasonality 用。#575 からの複製）

【機能】
- クエリ実行
- テーブルへのロード
- データエクスポート
"""

import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from google.cloud import bigquery

logger = logging.getLogger(__name__)


class BigQueryClient:
    """BigQuery クライアント"""
    
    def __init__(self, project_id: str = "food-scroll"):
        """
        Args:
            project_id: GCP プロジェクトID
        """
        self.client = bigquery.Client(project=project_id)
        self.project_id = project_id
        logger.info(f"BigQueryClient initialized with project={project_id}")
    
    def execute_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> bigquery.table.RowIterator:
        """
        クエリを実行して結果を返す
        
        Args:
            query: SQL クエリ文字列
            params: クエリパラメータ（テンプレート変数置換用）
            
        Returns:
            クエリ結果のイテレータ
        """
        # テンプレート変数を置換
        if params:
            for key, value in params.items():
                placeholder = f"${{{key}}}"
                if isinstance(value, list):
                    # リストの場合は UNNEST 用の配列リテラルに変換
                    value_str = "[" + ", ".join([f"'{v}'" for v in value]) + "]"
                    query = query.replace(placeholder, value_str)
                elif value is None or value == "":
                    # 空の場合は削除（LIMIT 句など）
                    query = query.replace(placeholder, "")
                else:
                    query = query.replace(placeholder, str(value))
        
        logger.info(f"Executing query (first 200 chars): {query[:200]}...")
        
        query_job = self.client.query(query)
        results = query_job.result()
        
        logger.info(f"Query completed: {results.total_rows} rows")
        return results
    
    def export_to_jsonl(self, query: str, output_path: Path, params: Optional[Dict[str, Any]] = None) -> int:
        """
        クエリ結果を JSONL ファイルにエクスポート
        
        Args:
            query: SQL クエリ文字列
            output_path: 出力先ファイルパス
            params: クエリパラメータ
            
        Returns:
            エクスポートした行数
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        results = self.execute_query(query, params)
        
        count = 0
        with open(output_path, 'w', encoding='utf-8') as f:
            for row in results:
                row_dict = dict(row.items())
                f.write(json.dumps(row_dict, ensure_ascii=False) + '\n')
                count += 1
        
        logger.info(f"Exported {count} rows to {output_path}")
        return count
    
    def load_from_jsonl(
        self,
        table_id: str,
        jsonl_path: Path,
        schema: List[bigquery.SchemaField],
        write_disposition: str = "WRITE_APPEND"
    ) -> int:
        """
        JSONL ファイルから BigQuery テーブルにロード
        
        Args:
            table_id: テーブルID（dataset.table 形式）
            jsonl_path: JSONL ファイルパス
            schema: テーブルスキーマ
            write_disposition: 書き込みモード（WRITE_APPEND, WRITE_TRUNCATE 等）
            
        Returns:
            ロードした行数
        """
        if not jsonl_path.exists():
            raise FileNotFoundError(f"JSONL file not found: {jsonl_path}")
        
        job_config = bigquery.LoadJobConfig(
            schema=schema,
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=write_disposition
        )
        
        with open(jsonl_path, 'rb') as f:
            load_job = self.client.load_table_from_file(
                f,
                table_id,
                job_config=job_config
            )
        
        load_job.result()  # 完了を待つ
        
        logger.info(f"Loaded {load_job.output_rows} rows to {table_id}")
        return load_job.output_rows
    
    def load_from_rows(
        self,
        table_id: str,
        rows: List[Dict],
        schema: List[bigquery.SchemaField],
        write_disposition: str = "WRITE_APPEND"
    ) -> int:
        """
        行データから BigQuery テーブルにロード
        
        Args:
            table_id: テーブルID（dataset.table 形式）
            rows: 行データのリスト
            schema: テーブルスキーマ
            write_disposition: 書き込みモード（WRITE_APPEND, WRITE_TRUNCATE 等）
            
        Returns:
            ロードした行数
        """
        if not rows:
            logger.warning("No rows to load")
            return 0
        
        job_config = bigquery.LoadJobConfig(
            schema=schema,
            write_disposition=write_disposition
        )
        
        # created_at フィールドを現在時刻で補完
        from datetime import datetime
        for row in rows:
            if 'created_at' in row and row['created_at'] is None:
                row['created_at'] = datetime.utcnow().isoformat()
        
        load_job = self.client.load_table_from_json(
            rows,
            table_id,
            job_config=job_config
        )
        
        load_job.result()  # 完了を待つ
        
        logger.info(f"Loaded {load_job.output_rows} rows to {table_id}")
        return load_job.output_rows
    
    def execute_merge(self, merge_query: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
        """
        MERGE クエリを実行
        
        Args:
            merge_query: MERGE SQL 文
            params: クエリパラメータ
            
        Returns:
            実行統計（inserted, updated, deleted の件数）
        """
        # テンプレート変数を置換
        if params:
            for key, value in params.items():
                placeholder = f"${{{key}}}"
                # サブクエリの場合はそのまま埋め込む
                merge_query = merge_query.replace(placeholder, str(value))
        
        logger.info(f"Executing MERGE query...")
        
        query_job = self.client.query(merge_query)
        query_job.result()
        
        # DML統計を取得
        stats = {
            "inserted": getattr(query_job, 'num_dml_affected_rows', 0),
            "updated": 0,  # BigQuery API では詳細な内訳が取れないため暫定
            "deleted": 0
        }
        
        logger.info(f"MERGE completed: affected {stats['inserted']} rows")
        return stats
