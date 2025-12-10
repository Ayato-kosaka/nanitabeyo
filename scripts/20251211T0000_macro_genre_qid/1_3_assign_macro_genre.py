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
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict
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


def fetch_dish_categories(conn, only_null: bool = False) -> List[str]:
    """
    対象 dish_categories を取得
    
    Args:
        conn: DB 接続
        only_null: True の場合、macro_genre_qid が NULL のもののみ取得
        
    Returns:
        dish_category の ID リスト
    """
    with conn.cursor() as cur:
        if only_null:
            cur.execute("""
                SELECT id
                FROM dish_categories
                WHERE macro_genre_qid IS NULL
                ORDER BY id
            """)
        else:
            cur.execute("""
                SELECT id
                FROM dish_categories
                ORDER BY id
            """)
        
        dish_ids = [row[0] for row in cur.fetchall()]
        logger.info(f"Found {len(dish_ids)} dish_categories to process")
        return dish_ids


def fetch_ancestors(conn, dish_id: str) -> List[Tuple[str, int]]:
    """
    単一の dish_category について ancestors を取得
    
    Args:
        conn: DB 接続
        dish_id: dish_category の ID
        
    Returns:
        [(ancestor_qid, depth), ...] のリスト（depth 昇順）
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ancestor_qid, depth
            FROM dish_category_ancestors
            WHERE dish_category_id = %s
            ORDER BY depth ASC, ancestor_qid ASC
        """, (dish_id,))
        
        return [(row[0], row[1]) for row in cur.fetchall()]


def find_macro_genre(
    ancestors: List[Tuple[str, int]],
    whitelist: Set[str]
) -> Tuple[Optional[str], bool, List[str]]:
    """
    ancestors から最初に whitelist にマッチする QID を見つける
    
    Args:
        ancestors: [(ancestor_qid, depth), ...] のリスト（depth 昇順）
        whitelist: macro_genre の QID 集合
        
    Returns:
        (macro_genre_qid, is_ambiguous, ambiguous_candidates) のタプル
        - macro_genre_qid: 決定した QID（None の場合は未決定）
        - is_ambiguous: 同一 depth で複数の候補が見つかった場合 True
        - ambiguous_candidates: ambiguous な場合の候補リスト
    """
    if not ancestors:
        return None, False, []
    
    # depth ごとにグループ化
    depth_groups = defaultdict(list)
    for ancestor_qid, depth in ancestors:
        depth_groups[depth].append(ancestor_qid)
    
    # depth の昇順で処理
    for depth in sorted(depth_groups.keys()):
        qids_at_depth = depth_groups[depth]
        matches = [qid for qid in qids_at_depth if qid in whitelist]
        
        if len(matches) == 1:
            # 一意に決定
            return matches[0], False, []
        elif len(matches) > 1:
            # ambiguous（同一 depth で複数マッチ）
            return None, True, matches
    
    # whitelist にマッチする ancestor が見つからなかった
    return None, False, []


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
        # whitelist をロード
        whitelist = load_whitelist(conn)
        
        if not whitelist:
            logger.error("No macro genres found in whitelist. Please populate macro_genre_whitelist table first.")
            sys.exit(1)
        
        # 対象 dish_categories を取得
        dish_ids = fetch_dish_categories(conn, only_null=args.only_null)
        
        if not dish_ids:
            logger.warning("No dish_categories to process")
            return
        
        # 各 dish_category について macro_genre を決定
        updates = []
        stats = {
            'assigned': 0,
            'not_found': 0,
            'ambiguous': 0
        }
        ambiguous_cases = []
        
        for i, dish_id in enumerate(dish_ids):
            if (i + 1) % 100 == 0:
                logger.info(f"Processed {i + 1}/{len(dish_ids)} dish_categories")
            
            # ancestors を取得
            ancestors = fetch_ancestors(conn, dish_id)
            
            if not ancestors:
                logger.debug(f"{dish_id}: No ancestors found")
                stats['not_found'] += 1
                continue
            
            # macro_genre を決定
            macro_genre_qid, is_ambiguous, ambiguous_candidates = find_macro_genre(ancestors, whitelist)
            
            if is_ambiguous:
                # ambiguous ケース
                logger.warning(f"{dish_id}: Ambiguous - multiple candidates at same depth: {ambiguous_candidates}")
                ambiguous_cases.append((dish_id, ambiguous_candidates))
                stats['ambiguous'] += 1
            elif macro_genre_qid:
                # 一意に決定
                updates.append((dish_id, macro_genre_qid))
                stats['assigned'] += 1
            else:
                # whitelist にマッチする ancestor が見つからなかった
                logger.debug(f"{dish_id}: No matching macro genre in whitelist")
                stats['not_found'] += 1
        
        # 結果をログ出力
        logger.info("=" * 60)
        logger.info("Summary:")
        logger.info(f"  Total processed: {len(dish_ids)}")
        logger.info(f"  Assigned: {stats['assigned']}")
        logger.info(f"  Not found in whitelist: {stats['not_found']}")
        logger.info(f"  Ambiguous: {stats['ambiguous']}")
        logger.info("=" * 60)
        
        if ambiguous_cases:
            logger.info("Ambiguous cases (same depth, multiple whitelist matches):")
            for dish_id, candidates in ambiguous_cases:
                logger.info(f"  {dish_id}: {candidates}")
            logger.info("These cases need manual review or whitelist adjustment")
            logger.info("=" * 60)
        
        # DB を更新
        if updates:
            update_macro_genre_qid(conn, updates, dry_run=args.dry_run)
        
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
