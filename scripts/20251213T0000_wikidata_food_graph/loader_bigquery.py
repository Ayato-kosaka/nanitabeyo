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
from datetime import datetime, timezone
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
            # エラーの詳細をログに記録
            failed_qids = [row["item_qid"] for row in rows_to_insert if any(err for err in errors)]
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
