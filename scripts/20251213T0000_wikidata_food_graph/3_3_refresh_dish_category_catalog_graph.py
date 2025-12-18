#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_3_refresh_dish_category_catalog_graph.py

【目的】
BigQuery 上の既存テーブルから graph 情報を作り、dish_category_catalog を MERGE 更新する

【処理内容】
1. food_paths から tags を再計算（depth <= 5 の祖先 QID）
2. dish_root_summary から roots を抽出（kind + min_depth の配列）
3. 一時テーブル経由で BigQuery に流し込み、MERGE する

【使用方法】
python3 3_3_refresh_dish_category_catalog_graph.py
"""

import sys
import logging
from pathlib import Path

from loader_bigquery import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"


def refresh_graph_data(bq_loader: BigQueryLoader) -> None:
    """
    #543 【設計】BigQuery 上で graph データ（tags, roots）を再計算し、MERGE する
    
    Args:
        bq_loader: BigQuery ローダー
    """
    target_table_id = f"{bq_loader.dataset_ref}.dish_category_catalog"
    
    logger.info(f"Refreshing graph data in {target_table_id}...")
    
    # #543 【設計】tags と roots を BigQuery 上で再計算して MERGE
    # tags: food_paths から depth <= 5 の祖先 QID を配列化
    # roots: dish_root_summary から kind を抽出して配列化
    sql = f"""
    MERGE `{target_table_id}` T
    USING (
      WITH catalog_items AS (
        -- #543 【設計】catalog に存在する item のみを対象
        SELECT item_qid
        FROM `{target_table_id}`
      ),
      tags_aggregated AS (
        -- #543 【設計】depth <= 5 の祖先を tags として集約
        SELECT
          fp.child_qid AS item_qid,
          ARRAY_AGG(DISTINCT fp.ancestor_qid ORDER BY fp.ancestor_qid) AS tags
        FROM `{bq_loader.dataset_ref}.food_paths` fp
        INNER JOIN catalog_items ci
          ON fp.child_qid = ci.item_qid
        WHERE fp.depth <= 5
          AND fp.depth > 0  -- #543 【設計】自分自身 (depth=0) は除外
        GROUP BY fp.child_qid
      ),
      roots_aggregated AS (
        -- #543 【設計】dish_root_summary から roots を抽出
        SELECT
          drs.dish_qid AS item_qid,
          ARRAY(
            SELECT AS STRUCT
              r.kind,
              r.min_depth
            FROM UNNEST(drs.roots) AS r
            ORDER BY r.min_depth, r.kind
          ) AS roots
        FROM `{bq_loader.dataset_ref}.dish_root_summary` drs
        INNER JOIN catalog_items ci
          ON drs.dish_qid = ci.item_qid
      )
      SELECT
        ci.item_qid,
        COALESCE(ta.tags, []) AS tags,
        ra.roots AS roots
      FROM catalog_items ci
      LEFT JOIN tags_aggregated ta
        ON ci.item_qid = ta.item_qid
      LEFT JOIN roots_aggregated ra
        ON ci.item_qid = ra.item_qid
    ) S
    ON T.item_qid = S.item_qid
    WHEN MATCHED THEN
      UPDATE SET
        tags = S.tags,
        roots = S.roots
    """
    
    affected = bq_loader.execute_dml(sql)
    logger.info(f"Updated {affected} rows with graph data")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("Refreshing dish_category_catalog (graph)")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # graph データを再計算して MERGE
    logger.info("Refreshing graph data (tags, roots)...")
    refresh_graph_data(bq_loader)
    
    logger.info("=" * 80)
    logger.info("✅ Successfully refreshed dish_category_catalog (graph)")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Next step:")
    logger.info("  Check the updated dish_category_catalog table in BigQuery")


if __name__ == "__main__":
    main()
