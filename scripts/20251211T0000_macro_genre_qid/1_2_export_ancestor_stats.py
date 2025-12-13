#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2_export_ancestor_stats.py

【目的】
macro_genre ホワイトリストを目検で作るための材料として、
dish_category_ancestors を ancestor_qid 単位に集計し、CSV 出力する。

【処理概要】
1. dish_category_ancestors を ancestor_qid ごとに集計
   - ancestor_qid ごとの dish_count（何件の dish_category がぶら下がっているか）
   - min_depth（どのくらい浅い階層から出現するか）
   - dish_ratio（全 dish_categories のうち何割をカバーしているか）
   - ancestor 自身の英語ラベル・日本語ラベル
     - 英語: dish_categories.label_en
     - 日本語: dish_categories.labels->>'ja'
   - 代表的な dish_category の label_en（最大 MAX_SAMPLE_DISHES 件）
2. ローカルファイル macro_genre_candidate_stats.csv に出力

【使用方法】
DATABASE_URL 環境変数が必要
例: DATABASE_URL="postgresql://user:pass@host:port/dbname" \
    python3 1_2_export_ancestor_stats.py

【出力】
macro_genre_candidate_stats.csv
- ancestor_qid : Wikidata QID
- label_en     : ancestor の英語ラベル（dish_categories.label_en）
- label_ja     : ancestor の日本語ラベル（dish_categories.labels->>'ja'）
- min_depth    : dish_category_ancestors での最小 depth
- dish_count   : この ancestor を持つ dish_category の数
- dish_ratio   : dish_count / 全 dish_category 数
- sample_dishes: 代表的な dish_category の label_en （"; " 区切り、最大 MAX_SAMPLE_DISHES 件）

【ラベル埋め作業】
label_en, label_ja は dish_categories と紐付かない場合存在しない。
そのため、足りないラベルは https://query.wikidata.org/ で以下のクエリを実行し補足する。
SELECT ?item ?itemLabel_en ?itemLabel_ja WHERE {
  VALUES ?item {  wd:Q16889133 wd:Q19478619 ... }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?item rdfs:label ?itemLabel_en .
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "ja" .
    ?item rdfs:label ?itemLabel_ja .
  }
}
"""

import os
import sys
import csv
import logging
from typing import List, Dict, Any

import psycopg2

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# 設定
OUTPUT_FILE = "macro_genre_candidate_stats.csv"
MAX_SAMPLE_DISHES = 5  # 各 ancestor につき表示する dish の最大数


def get_db_connection():
    """DATABASE_URL 環境変数から DB 接続を取得"""
    database_url = os.environ.get("DATABASE_URL")
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


def fetch_ancestor_stats(conn) -> List[Dict[str, Any]]:
    """
    dish_category_ancestors から ancestor_qid ごとの統計を取得

    Returns:
        [
          {
            "ancestor_qid": str,
            "label_en": str,
            "label_ja": str,
            "min_depth": int,
            "dish_count": int,
            "dish_ratio": float,
            "sample_dishes": List[str],
          },
          ...
        ] を dish_count の降順でソートしたリスト
    """
    with conn.cursor() as cur:
        # 改良版 SQL:
        # - total: dish_categories の全件数を取得
        # - a: dish_category_ancestors
        # - anc_dc: ancestor_qid に対応する dish_categories 行
        #
        # 注意:
        # ARRAY_AGG と LIMIT は同時に使えないので、
        # ARRAY(SELECT ... ORDER BY ... LIMIT %s) で回避している。
        query = f"""
            WITH total AS (
                SELECT COUNT(*) AS n_dish
                FROM dish_categories
            )
            SELECT
                a.ancestor_qid,
                anc_dc.label_en AS ancestor_label_en,
                anc_dc.labels->>'ja' AS ancestor_label_ja,
                MIN(a.depth) AS min_depth,
                COUNT(DISTINCT a.dish_category_id) AS dish_count,
                COUNT(DISTINCT a.dish_category_id)::float / t.n_dish AS dish_ratio,
                ARRAY(
                    SELECT dc.label_en
                    FROM dish_category_ancestors a2
                    JOIN dish_categories dc
                      ON dc.id = a2.dish_category_id
                    WHERE a2.ancestor_qid = a.ancestor_qid
                    ORDER BY dc.label_en
                    LIMIT %s
                ) AS sample_dishes
            FROM dish_category_ancestors a
            CROSS JOIN total t
            LEFT JOIN dish_categories anc_dc
              ON anc_dc.id = a.ancestor_qid
            GROUP BY
                a.ancestor_qid,
                anc_dc.label_en,
                anc_dc.labels->>'ja',
                t.n_dish
            ORDER BY dish_count DESC
        """

        cur.execute(query, (MAX_SAMPLE_DISHES,))

        results: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            ancestor_qid = row[0]
            label_en = row[1] or ""
            label_ja = row[2] or ""
            min_depth = row[3]
            dish_count = row[4]
            dish_ratio = float(row[5]) if row[5] is not None else 0.0
            sample_dishes = row[6] or []  # ARRAY は Python では list で返る

            results.append(
                {
                    "ancestor_qid": ancestor_qid,
                    "label_en": label_en,
                    "label_ja": label_ja,
                    "min_depth": min_depth,
                    "dish_count": dish_count,
                    "dish_ratio": dish_ratio,
                    "sample_dishes": sample_dishes,
                }
            )

        logger.info(f"Found {len(results)} unique ancestors")
        return results


def export_to_csv(stats: List[Dict[str, Any]], output_file: str):
    """
    統計データを CSV ファイルに出力

    Args:
        stats: 統計データのリスト
        output_file: 出力ファイル名
    """
    with open(output_file, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "ancestor_qid",
            "label_en",
            "label_ja",
            "min_depth",
            "dish_count",
            "dish_ratio",
            "sample_dishes",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)

        writer.writeheader()
        for row in stats:
            sample_dishes_str = "; ".join(
                [d for d in row.get("sample_dishes", []) if d]
            )
            writer.writerow(
                {
                    "ancestor_qid": row["ancestor_qid"],
                    "label_en": row["label_en"],
                    "label_ja": row["label_ja"],
                    "min_depth": row["min_depth"],
                    "dish_count": row["dish_count"],
                    "dish_ratio": row["dish_ratio"],
                    "sample_dishes": sample_dishes_str,
                }
            )

    logger.info(f"Exported {len(stats)} rows to {output_file}")


def main():
    """メイン処理"""
    logger.info("Starting 1_2_export_ancestor_stats.py")

    conn = get_db_connection()

    try:
        ancestor_stats = fetch_ancestor_stats(conn)

        if not ancestor_stats:
            logger.warning("No ancestor data found")
            return

        export_to_csv(ancestor_stats, OUTPUT_FILE)

        logger.info(
            "Completed: exported ancestor statistics to %s (total ancestors: %d)",
            OUTPUT_FILE,
            len(ancestor_stats),
        )
        logger.info(
            "Review this CSV and use it to decide macro_genre_whitelist QIDs."
        )

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
