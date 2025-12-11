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
        複数の QID について、P31/P279 を BFS で辿って ancestor を取得
        
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
        
        logger.info(f"Fetching ancestors for {len(valid_qids)} QIDs (max_depth={max_depth})")
        
        results = {}
        for qid in valid_qids:
            try:
                ancestors = self._bfs_ancestors(qid, max_depth)
                results[qid] = ancestors
                # Rate limit 対策: 少し待機
                time.sleep(0.1)
            except Exception as e:
                logger.error(f"Error fetching ancestors for {qid}: {e}")
                # エラーが発生しても他の QID の処理を続ける
                results[qid] = []
        
        return results
    
    def _bfs_ancestors(self, start_qid: str, max_depth: int) -> List[Tuple[str, int]]:
        """
        単一の QID について BFS で ancestor を取得
        
        Args:
            start_qid: 開始 QID
            max_depth: 最大深度
            
        Returns:
            [(ancestor_qid, depth), ...] のリスト
        """
        ancestors = [(start_qid, 0)]  # 自分自身も depth=0 で含める
        visited = {start_qid}
        queue = deque([(start_qid, 0)])
        
        while queue:
            current_qid, current_depth = queue.popleft()
            
            if current_depth >= max_depth:
                continue
            
            # P31 (instance of) と P279 (subclass of) を取得
            # #533 【セキュリティ】current_qid は _bfs_ancestors 呼び出し前にバリデーション済み（Q + 数字のみ）
            query = f"""
            SELECT DISTINCT ?parent WHERE {{
                wd:{current_qid} (wdt:P31|wdt:P279) ?parent .
                FILTER(STRSTARTS(STR(?parent), "http://www.wikidata.org/entity/Q"))
            }}
            """
            
            self.sparql.setQuery(query)
            
            try:
                sparql_results = self.sparql.query().convert()
                
                for result in sparql_results["results"]["bindings"]:
                    parent_uri = result["parent"]["value"]
                    parent_qid = parent_uri.split("/")[-1]
                    
                    if parent_qid not in visited:
                        visited.add(parent_qid)
                        next_depth = current_depth + 1
                        ancestors.append((parent_qid, next_depth))
                        queue.append((parent_qid, next_depth))
                
                # Rate limit 対策
                time.sleep(0.05)
                
            except Exception as e:
                logger.warning(f"Failed to fetch parents for {current_qid}: {e}")
                continue
        
        return ancestors


def get_db_connection():
    """DATABASE_URL 環境変数から DB 接続を取得"""
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        logger.error("DATABASE_URL environment variable is not set")
        sys.exit(1)
    
    try:
        conn = psycopg2.connect(database_url)
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
        truncate_ancestors(conn)
        
        # Wikidata フェッチャーを初期化
        fetcher = WikidataFetcher()
        
        # バッチ処理
        total_processed = 0
        total_ancestors = 0
        
        for i in range(0, len(qids), BATCH_SIZE):
            batch = qids[i:i + BATCH_SIZE]
            logger.info(f"Processing batch {i // BATCH_SIZE + 1}/{(len(qids) + BATCH_SIZE - 1) // BATCH_SIZE}")
            
            try:
                # ancestors を取得
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
