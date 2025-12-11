#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_export_ancestor_stats.py

【目的】
macro_genre ホワイトリストを目検で作るための材料として、
dish_category_ancestors を集計・CSV出力する

【処理概要】
1. dish_category_ancestors を ancestor_qid 単位に集計
   - ancestor_qid ごとの dish_count
   - 代表的な dish_category のラベル（数件）も一緒に出力
2. Wikidata から ancestor_qid の label_en / label_ja を取得
3. ローカルファイル macro_genre_candidate_stats.csv に出力

【使用方法】
DATABASE_URL 環境変数が必要
例: DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev" python3 1_2_export_ancestor_stats.py

【出力】
macro_genre_candidate_stats.csv
- ancestor_qid: Wikidata QID
- label_en: 英語ラベル
- label_ja: 日本語ラベル
- dish_count: この ancestor を持つ dish_category の数
- sample_dishes: 代表的な dish_category のラベル（最大5件）
"""

import os
import sys
import csv
import logging
import time
from typing import Dict, List, Tuple
from collections import defaultdict
import psycopg2
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
USER_AGENT = "nanitabeyo-macro-genre-batch/1.0 (https://github.com/Ayato-kosaka/nanitabeyo)"
OUTPUT_FILE = "macro_genre_candidate_stats.csv"
MAX_SAMPLE_DISHES = 5  # 各 ancestor につき表示する dish の最大数


class WikidataLabelFetcher:
    """Wikidata からラベルを取得するクラス"""
    
    def __init__(self):
        self.sparql = SPARQLWrapper(SPARQL_ENDPOINT)
        self.sparql.setReturnFormat(JSON)
        self.sparql.addCustomHttpHeader("User-Agent", USER_AGENT)
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type((Exception,))
    )
    def fetch_labels(self, qids: List[str]) -> Dict[str, Dict[str, str]]:
        """
        複数の QID についてラベルを取得
        
        Args:
            qids: Wikidata QID のリスト
            
        Returns:
            {qid: {"label_en": "...", "label_ja": "..."}} の辞書
        """
        if not qids:
            return {}
        
        # QID のバリデーション
        valid_qids = [qid for qid in qids if qid.startswith('Q') and qid[1:].isdigit()]
        if not valid_qids:
            return {}
        
        logger.info(f"Fetching labels for {len(valid_qids)} QIDs")
        
        # VALUES 句で複数 QID を一度に取得
        # #533 【セキュリティ】valid_qids は直前で QID バリデーション済み（Q + 数字のみ）
        values_clause = " ".join([f"wd:{qid}" for qid in valid_qids])
        
        query = f"""
        SELECT ?item ?labelEn ?labelJa WHERE {{
            VALUES ?item {{ {values_clause} }}
            OPTIONAL {{ ?item rdfs:label ?labelEn . FILTER(LANG(?labelEn) = "en") }}
            OPTIONAL {{ ?item rdfs:label ?labelJa . FILTER(LANG(?labelJa) = "ja") }}
        }}
        """
        
        self.sparql.setQuery(query)
        
        try:
            results = self.sparql.query().convert()
            
            # 結果を辞書に変換
            labels = {qid: {"label_en": "", "label_ja": ""} for qid in valid_qids}
            
            for result in results["results"]["bindings"]:
                item_uri = result["item"]["value"]
                qid = item_uri.split("/")[-1]
                
                if "labelEn" in result:
                    labels[qid]["label_en"] = result["labelEn"]["value"]
                if "labelJa" in result:
                    labels[qid]["label_ja"] = result["labelJa"]["value"]
            
            # Rate limit 対策
            time.sleep(0.5)
            
            return labels
            
        except Exception as e:
            logger.error(f"Failed to fetch labels: {e}")
            # エラー時は空の辞書を返す
            return {qid: {"label_en": "", "label_ja": ""} for qid in valid_qids}


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


def fetch_ancestor_stats(conn) -> List[Tuple[str, int, List[str]]]:
    """
    dish_category_ancestors から ancestor_qid ごとの統計を取得
    
    Returns:
        [(ancestor_qid, dish_count, [sample_dish_ids, ...]), ...] のリスト
        dish_count の降順でソート
    """
    with conn.cursor() as cur:
        # ancestor_qid ごとに集計し、代表的な dish_category も取得
        # #533 【セキュリティ】MAX_SAMPLE_DISHES は定数なので SQL に直接埋め込んでも安全
        cur.execute(f"""
            SELECT
                ancestor_qid,
                COUNT(DISTINCT dish_category_id) as dish_count,
                ARRAY_AGG(DISTINCT dish_category_id ORDER BY dish_category_id LIMIT {MAX_SAMPLE_DISHES}) as sample_dishes
            FROM dish_category_ancestors
            GROUP BY ancestor_qid
            ORDER BY dish_count DESC
        """)
        
        results = []
        for row in cur.fetchall():
            ancestor_qid = row[0]
            dish_count = row[1]
            sample_dishes = row[2] if row[2] else []
            results.append((ancestor_qid, dish_count, sample_dishes))
        
        logger.info(f"Found {len(results)} unique ancestors")
        return results


def fetch_dish_labels(conn, dish_ids: List[str]) -> Dict[str, str]:
    """
    dish_categories からラベルを取得
    
    Args:
        conn: DB 接続
        dish_ids: dish_category の ID リスト
        
    Returns:
        {dish_id: label_en} の辞書
    """
    if not dish_ids:
        return {}
    
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, label_en
            FROM dish_categories
            WHERE id = ANY(%s)
        """, (dish_ids,))
        
        return {row[0]: row[1] for row in cur.fetchall()}


def export_to_csv(stats: List[Dict[str, any]], output_file: str):
    """
    統計データを CSV ファイルに出力
    
    Args:
        stats: 統計データのリスト
        output_file: 出力ファイル名
    """
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['ancestor_qid', 'label_en', 'label_ja', 'dish_count', 'sample_dishes']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        
        writer.writeheader()
        for row in stats:
            writer.writerow(row)
    
    logger.info(f"Exported {len(stats)} rows to {output_file}")


def main():
    """メイン処理"""
    logger.info("Starting export_ancestor_stats.py")
    
    # DB 接続
    conn = get_db_connection()
    
    try:
        # ancestor 統計を取得
        ancestor_stats = fetch_ancestor_stats(conn)
        
        if not ancestor_stats:
            logger.warning("No ancestor data found")
            return
        
        # 全 ancestor の QID リストを作成
        ancestor_qids = [stat[0] for stat in ancestor_stats]
        
        # Wikidata からラベルを取得（バッチサイズ 50 で分割）
        label_fetcher = WikidataLabelFetcher()
        all_labels = {}
        
        batch_size = 50
        for i in range(0, len(ancestor_qids), batch_size):
            batch = ancestor_qids[i:i + batch_size]
            logger.info(f"Fetching labels batch {i // batch_size + 1}/{(len(ancestor_qids) + batch_size - 1) // batch_size}")
            
            try:
                batch_labels = label_fetcher.fetch_labels(batch)
                all_labels.update(batch_labels)
            except Exception as e:
                logger.error(f"Error fetching labels for batch starting at {i}: {e}")
                # エラーが発生しても続行（空ラベルで処理）
                for qid in batch:
                    if qid not in all_labels:
                        all_labels[qid] = {"label_en": "", "label_ja": ""}
        
        # 全 sample_dishes の QID を収集
        all_dish_ids = set()
        for _, _, sample_dishes in ancestor_stats:
            all_dish_ids.update(sample_dishes)
        
        # dish_categories からラベルを取得
        dish_labels = fetch_dish_labels(conn, list(all_dish_ids))
        
        # CSV 出力用のデータを作成
        output_data = []
        for ancestor_qid, dish_count, sample_dishes in ancestor_stats:
            labels = all_labels.get(ancestor_qid, {"label_en": "", "label_ja": ""})
            
            # sample_dishes をラベルに変換
            sample_dish_labels = [
                dish_labels.get(dish_id, dish_id)
                for dish_id in sample_dishes
            ]
            sample_dishes_str = "; ".join(sample_dish_labels)
            
            output_data.append({
                "ancestor_qid": ancestor_qid,
                "label_en": labels["label_en"],
                "label_ja": labels["label_ja"],
                "dish_count": dish_count,
                "sample_dishes": sample_dishes_str
            })
        
        # CSV に出力
        export_to_csv(output_data, OUTPUT_FILE)
        
        logger.info(f"Completed: exported ancestor statistics to {OUTPUT_FILE}")
        logger.info(f"Total ancestors: {len(output_data)}")
        logger.info(f"Review the file and insert selected QIDs into macro_genre_whitelist table")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
