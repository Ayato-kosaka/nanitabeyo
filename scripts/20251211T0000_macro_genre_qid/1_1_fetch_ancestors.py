#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_fetch_ancestors.py

【目的】
dish_categories.id（= Wikidata QID）ごとに、Wikidata SPARQL を叩いて
P31/P279 の ancestor を再帰取得し、dish_category_ancestors テーブルに保存する

【処理概要】
1. DB から対象の dish_categories を取得
2. 適度なバッチサイズ（100件）で QID をまとめて SPARQL クエリに投げる
3. 各 dish について P31 / P279 を BFS で深さ 3〜4 まで辿る
4. dish_category_ancestors を TRUNCATE してから、バルク INSERT
5. エラー時はログ出力してスキップ（再実行でリカバリ可能）

【使用方法】
DATABASE_URL 環境変数が必要
例: DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev" python3 1_1_fetch_ancestors.py

【注意】
- SPARQL endpoint の rate limit 対策として retry/backoff を実装
- 一時テーブルは作成しない（常設テーブルのみ使用）
"""

import os
import sys
import time
import logging
from collections import deque
from typing import List, Dict, Set, Tuple
import psycopg2
from psycopg2.extras import execute_batch
from SPARQLWrapper import SPARQLWrapper, JSON
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 設定
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
BATCH_SIZE = 100  # SPARQL クエリのバッチサイズ
MAX_DEPTH = 4     # BFS の最大深度
USER_AGENT = "nanitabeyo-macro-genre-batch/1.0 (https://github.com/Ayato-kosaka/nanitabeyo)"


class WikidataFetcher:
    """Wikidata SPARQL クエリを実行するクラス"""
    
    def __init__(self):
        self.sparql = SPARQLWrapper(SPARQL_ENDPOINT)
        self.sparql.setReturnFormat(JSON)
        self.sparql.addCustomHttpHeader("User-Agent", USER_AGENT)
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type((Exception,))
    )
    def fetch_ancestors_batch(self, qids: List[str], max_depth: int) -> Dict[str, List[Tuple[str, int]]]:
        """
        複数の QID について、P31/P279 を BFS で辿って ancestor を取得（バッチクエリ）
        
        Args:
            qids: Wikidata QID のリスト
            max_depth: BFS の最大深度
            
        Returns:
            {qid: [(ancestor_qid, depth), ...]} の辞書
        """
        # QID のバリデーション
        valid_qids = [qid for qid in qids if qid.startswith('Q') and qid[1:].isdigit()]
        if not valid_qids:
            return {}
        
        logger.info(f"Fetching ancestors (batch) for {len(valid_qids)} QIDs (max_depth={max_depth})")
        
        # ancestors: start_qid -> {node_qid: depth}
        ancestors: Dict[str, Dict[str, int]] = {qid: {qid: 0} for qid in valid_qids}
        # level_nodes: depth -> start_qid -> set(node_qid)
        level_nodes: Dict[int, Dict[str, Set[str]]] = {0: {qid: {qid} for qid in valid_qids}}
        
        # helper: chunk list
        def _chunks(lst: List[str], size: int) -> List[List[str]]:
            return [lst[i:i + size] for i in range(0, len(lst), size)]
        
        for d in range(0, max_depth):
            # 終了判定: この深さで探索対象があるか
            current_level = level_nodes.get(d, {})
            if not current_level:
                break
            frontier_nodes: Set[str] = set().union(*current_level.values()) if current_level else set()
            if not frontier_nodes:
                break
            
            # child -> set(parents)
            parents_by_child: Dict[str, Set[str]] = {}
            
            # 大きすぎる VALUES を分割
            frontier_list = list(frontier_nodes)
            # 過度なクエリを避けるため、VALUES のサイズは 300 までに制限
            for chunk in _chunks(frontier_list, 300):
                # SPARQL クエリを構築
                values = " ".join([f"wd:{qid}" for qid in chunk])
                query = f"""
                SELECT ?item ?parent WHERE {{
                  VALUES ?item {{ {values} }}
                  ?item (wdt:P31|wdt:P279) ?parent .
                  FILTER(STRSTARTS(STR(?parent), "http://www.wikidata.org/entity/Q"))
                }}
                """
                self.sparql.setQuery(query)
                try:
                    sparql_results = self.sparql.query().convert()
                    for result in sparql_results.get("results", {}).get("bindings", []):
                        item_uri = result["item"]["value"]
                        parent_uri = result["parent"]["value"]
                        child_qid = item_uri.split("/")[-1]
                        parent_qid = parent_uri.split("/")[-1]
                        if not (parent_qid.startswith('Q') and parent_qid[1:].isdigit()):
                            continue
                        parents_by_child.setdefault(child_qid, set()).add(parent_qid)
                except Exception as e:
                    logger.warning(f"Failed batch parents fetch at depth {d}: {e}")
                    # 続行（このチャンクはスキップ）
                    continue
                # 軽い rate limit 対策
                time.sleep(0.5)
            
            # 次のレベルの初期化
            level_nodes[d + 1] = {qid: set() for qid in valid_qids}
            
            # 結果を start_qid ごとに割り振り
            for start_qid, nodes_at_d in current_level.items():
                for node in nodes_at_d:
                    for parent in parents_by_child.get(node, set()):
                        if parent not in ancestors[start_qid]:
                            ancestors[start_qid][parent] = d + 1
                            level_nodes[d + 1][start_qid].add(parent)
            
            # この深さで新たなノードが全く無ければ打ち切り
            if all(len(s) == 0 for s in level_nodes[d + 1].values()):
                break
        
        # 戻り値の整形
        return {
            start_qid: [(node, depth) for node, depth in nodes.items()]
            for start_qid, nodes in ancestors.items()
        }


def get_db_connection():
    """DATABASE_URL 環境変数から DB 接続を取得"""
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        logger.error("DATABASE_URL environment variable is not set")
        sys.exit(1)
    
    try:
        conn = psycopg2.connect(database_url)
        with conn.cursor() as cur:
            cur.execute("SET search_path TO dev;")
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        sys.exit(1)


def fetch_dish_categories(conn) -> List[str]:
    """
    dish_categories から QID のリストを取得
    必要に応じて WHERE 条件でフィルタリング可能
    """
    with conn.cursor() as cur:
        # 全件取得（再実行時は macro_genre_qid IS NULL でフィルタも可能）
        cur.execute("""
            SELECT id
            FROM dish_categories
            WHERE id not in (
                SELECT DISTINCT dish_category_id
                FROM dish_category_ancestors
            )
            ORDER BY id
        """)
        rows = cur.fetchall()
        qids = [row[0] for row in rows]
        logger.info(f"Found {len(qids)} dish_categories")
        return qids


def truncate_ancestors(conn):
    """dish_category_ancestors テーブルを TRUNCATE"""
    with conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE dish_category_ancestors")
        conn.commit()
        logger.info("Truncated dish_category_ancestors table")


def insert_ancestors(conn, dish_qid: str, ancestors: List[Tuple[str, int]]):
    """
    単一の dish_category について ancestors を INSERT
    
    Args:
        conn: DB 接続
        dish_qid: dish_category の QID
        ancestors: [(ancestor_qid, depth), ...] のリスト
    """
    if not ancestors:
        return
    
    with conn.cursor() as cur:
        data = [
            (dish_qid, ancestor_qid, depth)
            for ancestor_qid, depth in ancestors
        ]
        
        execute_batch(
            cur,
            """
            INSERT INTO dish_category_ancestors (dish_category_id, ancestor_qid, depth)
            VALUES (%s, %s, %s)
            ON CONFLICT (dish_category_id, ancestor_qid) DO UPDATE
            SET depth = EXCLUDED.depth
            """,
            data,
            page_size=1000
        )


def main():
    """メイン処理"""
    logger.info("Starting fetch_ancestors.py")
    
    # DB 接続
    conn = get_db_connection()
    
    try:
        # dish_categories を取得
        qids = fetch_dish_categories(conn)
        
        if not qids:
            logger.warning("No dish_categories found")
            return
        
        # 既存データをクリア
        # truncate_ancestors(conn)
        
        # Wikidata フェッチャーを初期化
        fetcher = WikidataFetcher()
        
        # バッチ処理
        total_processed = 0
        total_ancestors = 0
        
        for i in range(0, len(qids), BATCH_SIZE):
            batch = qids[i:i + BATCH_SIZE]
            logger.info(f"Processing batch {i // BATCH_SIZE + 1}/{(len(qids) + BATCH_SIZE - 1) // BATCH_SIZE}")
            
            try:
                # ancestors を取得（バッチ BFS）
                batch_results = fetcher.fetch_ancestors_batch(batch, MAX_DEPTH)
                
                # DB に保存
                for dish_qid, ancestors in batch_results.items():
                    if ancestors:
                        insert_ancestors(conn, dish_qid, ancestors)
                        total_ancestors += len(ancestors)
                    total_processed += 1
                
                conn.commit()
                logger.info(f"Committed batch: processed {total_processed}/{len(qids)} dishes, {total_ancestors} total ancestors")
                
            except Exception as e:
                logger.error(f"Error processing batch starting at index {i}: {e}")
                conn.rollback()
                # エラーが発生してもスキップして続行
                continue
        
        logger.info(f"Completed: processed {total_processed} dishes, inserted {total_ancestors} ancestor relationships")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
