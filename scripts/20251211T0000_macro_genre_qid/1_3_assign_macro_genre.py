#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_assign_macro_genre.py

【目的】
macro_genre_whitelist をもとに、dish_category_ancestors から BFS 最短ヒットで
macro_genre_qid を決定し、dish_categories を一括更新する

【処理概要】
1. DB から macro_genre_whitelist を全件ロード
2. 対象 dish_categories を取得（初回は全件、再実行時は macro_genre_qid IS NULL のみなど）
3. 各 dish_category について：
   - dish_category_ancestors から (ancestor_qid, depth) を depth 昇順で取得
   - 先頭から順に ancestor_qid が whitelist に存在するかチェック
   - 最初にマッチした ancestor_qid を macro_genre_qid に採用
   - 一件もマッチしなければ None（DB上は NULL のまま）
4. 更新対象をまとめて UPDATE dish_categories
5. ambiguous ケース（同 depth で複数 whitelist ヒット）をログに出力

【使用方法】
DATABASE_URL 環境変数が必要
例: DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev" python3 1_3_assign_macro_genre.py

オプション:
  --dry-run: 実際の UPDATE を行わず、差分だけログ出力

【注意】
- ambiguous ケース（同 depth で whitelist に複数ヒット）は自動では決定せず、
  ログに出力し、macro_genre_qid は NULL のままとする
"""

import os
import sys
import logging
import argparse
from typing import List, Set, Tuple
import psycopg2
from psycopg2.extras import execute_batch

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


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


def load_whitelist(conn) -> Set[str]:
    """
    macro_genre_whitelist を全件ロード
    
    Returns:
        whitelist に含まれる QID の集合
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT macro_genre_qid, label_en, label_ja
            FROM macro_genre_whitelist
            ORDER BY macro_genre_qid
        """)
        
        whitelist = set()
        for row in cur.fetchall():
            qid = row[0]
            label_en = row[1] or ""
            label_ja = row[2] or ""
            whitelist.add(qid)
            logger.info(f"Whitelist: {qid} ({label_en} / {label_ja})")
        
        logger.info(f"Loaded {len(whitelist)} macro genres from whitelist")
        return whitelist


def compute_updates(conn, only_null: bool) -> List[Tuple[str, str]]:
    """JOIN と DISTINCT ON を使って、最短 depth の最初のヒットを一括取得する"""
    where_clause = "d.macro_genre_qid IS NULL" if only_null else "TRUE"
    sql = f"""
        SELECT DISTINCT ON (d.id)
            d.id AS dish_id,
            a.ancestor_qid AS macro_genre_qid,
            a.depth
        FROM dish_categories d
        JOIN dish_category_ancestors a
          ON a.dish_category_id = d.id
        JOIN macro_genre_whitelist w
          ON w.macro_genre_qid = a.ancestor_qid
        WHERE {where_clause}
        ORDER BY
            d.id,
            a.depth ASC,
            a.ancestor_qid ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        updates = [(row[0], row[1]) for row in rows]
        logger.info(f"Candidate assignments computed: {len(updates)}")
        return updates


def log_ambiguous_cases(conn, only_null: bool) -> int:
    """同 depth で whitelist ヒットが複数ある dish をログ出力（更新はしない）"""
    where_clause = "d.macro_genre_qid IS NULL" if only_null else "TRUE"
    # 最小 depth を求め、その depth における whitelist ヒット数が複数のものを検出
    sql = f"""
        WITH hits AS (
            SELECT d.id AS dish_id, a.depth, a.ancestor_qid
            FROM dish_categories d
            JOIN dish_category_ancestors a ON a.dish_category_id = d.id
            JOIN macro_genre_whitelist w ON w.macro_genre_qid = a.ancestor_qid
            WHERE {where_clause}
        ), min_depth AS (
            SELECT dish_id, MIN(depth) AS min_depth
            FROM hits
            GROUP BY dish_id
        ), same_min AS (
            SELECT h.dish_id, h.depth, COUNT(*) AS cnt,
                   ARRAY_AGG(h.ancestor_qid ORDER BY h.ancestor_qid) AS candidates
            FROM hits h
            JOIN min_depth m ON m.dish_id = h.dish_id AND m.min_depth = h.depth
            GROUP BY h.dish_id, h.depth
        )
        SELECT dish_id, candidates
        FROM same_min
        WHERE cnt > 1
        ORDER BY dish_id
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        for dish_id, candidates in rows:
            logger.warning(f"{dish_id}: Ambiguous - multiple candidates at minimal depth: {list(candidates)}")
        return len(rows)


def update_macro_genre_qid(conn, updates: List[Tuple[str, str]], dry_run: bool = False):
    """
    dish_categories の macro_genre_qid を一括更新
    
    Args:
        conn: DB 接続
        updates: [(dish_id, macro_genre_qid), ...] のリスト
        dry_run: True の場合は実際の UPDATE を行わない
    """
    if not updates:
        logger.warning("No updates to perform")
        return
    
    if dry_run:
        logger.info(f"[DRY RUN] Would update {len(updates)} dish_categories")
        for dish_id, macro_genre_qid in updates[:10]:  # 最初の10件だけ表示
            logger.info(f"[DRY RUN] {dish_id} -> {macro_genre_qid}")
        if len(updates) > 10:
            logger.info(f"[DRY RUN] ... and {len(updates) - 10} more")
        return
    
    with conn.cursor() as cur:
        execute_batch(
            cur,
            """
            UPDATE dish_categories
            SET macro_genre_qid = %s
            WHERE id = %s
            """,
            [(macro_genre_qid, dish_id) for dish_id, macro_genre_qid in updates],
            page_size=1000
        )
        conn.commit()
    
    logger.info(f"Updated {len(updates)} dish_categories")


def main():
    """メイン処理"""
    # コマンドライン引数のパース
    parser = argparse.ArgumentParser(
        description='Assign macro_genre_qid to dish_categories based on whitelist'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Do not perform actual UPDATE, only log the changes'
    )
    parser.add_argument(
        '--only-null',
        action='store_true',
        help='Process only dish_categories where macro_genre_qid IS NULL'
    )
    args = parser.parse_args()
    
    logger.info("Starting assign_macro_genre.py")
    if args.dry_run:
        logger.info("Running in DRY RUN mode")
    
    # DB 接続
    conn = get_db_connection()
    
    try:
        # whitelist をロード（存在確認とログ用）
        whitelist = load_whitelist(conn)
        
        if not whitelist:
            logger.error("No macro genres found in whitelist. Please populate macro_genre_whitelist table first.")
            sys.exit(1)
        
        # 一括で候補計算
        updates = compute_updates(conn, only_null=args.only_null)
        
        # ambiguous ケースを検出してログ
        ambiguous_count = log_ambiguous_cases(conn, only_null=args.only_null)
        
        # 集計ログ
        logger.info("=" * 60)
        logger.info("Summary:")
        logger.info(f"  Total candidate assignments: {len(updates)}")
        logger.info(f"  Ambiguous (multiple hits at minimal depth): {ambiguous_count}")
        logger.info("=" * 60)
        
        # ambiguous の dish は更新しないため、updates から除外
        if ambiguous_count:
            # もう一度、曖昧でない dish のみを抽出するクエリを使う
            # 最小 depth でヒット数が 1 のものだけ選ぶ
            where_clause = "d.macro_genre_qid IS NULL" if args.only_null else "TRUE"
            sql_unambiguous = f"""
                WITH hits AS (
                    SELECT d.id AS dish_id, a.depth, a.ancestor_qid
                    FROM dish_categories d
                    JOIN dish_category_ancestors a ON a.dish_category_id = d.id
                    JOIN macro_genre_whitelist w ON w.macro_genre_qid = a.ancestor_qid
                    WHERE {where_clause}
                ), min_depth AS (
                    SELECT dish_id, MIN(depth) AS min_depth
                    FROM hits
                    GROUP BY dish_id
                ), counts AS (
                    SELECT h.dish_id, h.depth, COUNT(*) AS cnt
                    FROM hits h
                    JOIN min_depth m ON m.dish_id = h.dish_id AND m.min_depth = h.depth
                    GROUP BY h.dish_id, h.depth
                )
                SELECT DISTINCT ON (d.id)
                    d.id AS dish_id,
                    a.ancestor_qid AS macro_genre_qid,
                    a.depth
                FROM dish_categories d
                JOIN dish_category_ancestors a ON a.dish_category_id = d.id
                JOIN macro_genre_whitelist w ON w.macro_genre_qid = a.ancestor_qid
                JOIN counts c ON c.dish_id = d.id AND c.depth = a.depth AND c.cnt = 1
                WHERE {where_clause}
                ORDER BY d.id, a.depth ASC, a.ancestor_qid ASC
            """
            with conn.cursor() as cur:
                cur.execute(sql_unambiguous)
                rows = cur.fetchall()
                updates = [(row[0], row[1]) for row in rows]
                logger.info(f"Unambiguous assignments: {len(updates)}")
        
        # DB を更新
        if updates:
            update_macro_genre_qid(conn, updates, dry_run=args.dry_run)
        else:
            logger.info("No unambiguous assignments to update")
        
        if args.dry_run:
            logger.info("DRY RUN completed. No changes were made to the database.")
        else:
            logger.info("Completed: macro_genre_qid assignment finished")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
