#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_4_apply_region_llm_results.py

【目的】
wikidata_food_llm_labels から allow & confidence=high のみ抽出し、
dish_category_features_catalog に MERGE 反映する

【処理内容】
1. wikidata_food_llm_labels から統計情報を取得
2. allow & confidence=high のみを抽出
3. dish_category_features_catalog に MERGE（過分削除含む）

【使用方法】
# dry-run モード（実際には反映しない）
python3 1_4_apply_region_llm_results.py --market scope:global --run_id 20251218T0000_global_v1 --dry-run

# 実際に反映
python3 1_4_apply_region_llm_results.py --market scope:global --run_id 20251218T0000_global_v1
python3 1_4_apply_region_llm_results.py --market country:JP --run_id 20251218T0100_jp_v1

【注意】
- 自動反映対象は decision='allow' AND confidence='high' のみ（Precision 最優先）
- confidence!=high または uncertain は pass2（再挑戦レーン）候補として残す
- 過分削除：同一 run_id / market / feature_key で今回 allow/high に含まれない item は削除
"""

import sys
import logging
import argparse
from pathlib import Path
from collections import Counter

# #557 【設計】親ディレクトリを sys.path に追加してモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent.parent))

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


def get_llm_statistics(bq_loader: BigQueryLoader, market: str, run_id: str):
    """
    wikidata_food_llm_labels から統計情報を取得
    
    Args:
        bq_loader: BigQueryLoader インスタンス
        market: 'scope:global' または 'country:JP'
        run_id: 実行識別子
    """
    # #557 【設計】task 命名規則
    if market == "country:JP":
        task = "#557_region_country_JP"
    else:
        task = "#557_region_scope_global"
    
    sql = f"""
    SELECT
      label,
      confidence,
      COUNT(*) as count
    FROM `{bq_loader.dataset_ref}.wikidata_food_llm_labels`
    WHERE task = '{task}'
      AND run_id = '{run_id}'
    GROUP BY label, confidence
    ORDER BY label, confidence
    """
    
    logger.info("Fetching LLM statistics...")
    result = bq_loader.client.query(sql).result()
    
    logger.info("=" * 80)
    logger.info("LLM Statistics")
    logger.info("=" * 80)
    
    total = 0
    allow_high = 0
    
    for row in result:
        count = row.count
        total += count
        logger.info(f"  {row.label} + {row.confidence}: {count}")
        
        if row.label == "allow" and row.confidence == "high":
            allow_high = count
    
    logger.info("=" * 80)
    logger.info(f"Total: {total}")
    logger.info(f"Allow + High: {allow_high} ({allow_high/total*100:.1f}%)" if total > 0 else "Allow + High: 0")
    logger.info("=" * 80)
    
    return allow_high


def apply_to_features_catalog(
    bq_loader: BigQueryLoader,
    market: str,
    run_id: str,
    dry_run: bool = False
):
    """
    dish_category_features_catalog に MERGE 反映
    
    Args:
        bq_loader: BigQueryLoader インスタンス
        market: 'scope:global' または 'country:JP'
        run_id: 実行識別子
        dry_run: True の場合は実際には反映しない
    """
    # #557 【設計】task 命名規則
    if market == "country:JP":
        task = "#557_region_country_JP"
    else:
        task = "#557_region_scope_global"
    
    # #557 【設計】feature_key 命名規則
    feature_key = f"region:{market}"
    
    logger.info("=" * 80)
    logger.info("Applying to dish_category_features_catalog")
    logger.info("=" * 80)
    logger.info(f"Task: {task}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Feature key: {feature_key}")
    logger.info(f"Dry run: {dry_run}")
    logger.info("=" * 80)
    
    # #557 【設計】allow & confidence=high のみを抽出
    logger.info("Step 1: Extract allow & high items...")
    
    extract_sql = f"""
    SELECT
      item_qid,
      confidence,
      reason
    FROM `{bq_loader.dataset_ref}.wikidata_food_llm_labels`
    WHERE task = '{task}'
      AND run_id = '{run_id}'
      AND label = 'allow'
      AND confidence = 'high'
    """
    
    result = bq_loader.client.query(extract_sql).result()
    items = [(row.item_qid, row.confidence, row.reason) for row in result]
    
    logger.info(f"Found {len(items)} items to apply")
    
    if not items:
        logger.warning("No items to apply")
        return
    
    if dry_run:
        logger.info("=" * 80)
        logger.info("DRY RUN MODE - No changes will be made")
        logger.info("=" * 80)
        logger.info(f"Would delete all existing entries for feature_key={feature_key}")
        logger.info(f"Would insert {len(items)} new items")
        return
    
    # #557 【設計】MERGE で反映（過分削除含む）
    logger.info("Step 2: Delete old entries for this feature_key and run_id...")
    
    # 既存の同じ feature_key のエントリを削除
    delete_old_sql = f"""
    DELETE FROM `{bq_loader.dataset_ref}.dish_category_features_catalog`
    WHERE feature_type = 'gate'
      AND feature_key = '{feature_key}'
    """
    
    deleted_old = bq_loader.execute_dml(delete_old_sql)
    logger.info(f"Deleted {deleted_old} old entries")
    
    logger.info("Step 3: INSERT new entries...")
    
    # 値を構築
    values_list = []
    for item_qid, confidence, reason in items:
        # #557 【セキュリティ】note に confidence + reason を保存（適切にエスケープ）
        reason_clean = reason.replace("\\", "\\\\").replace("'", "\\'") if reason else ""
        note = f"{confidence}: {reason_clean[:100]}" if reason_clean else confidence
        values_list.append(
            f"('{item_qid}', 'gate', '{feature_key}', 1.0, 'llm', '{run_id}', CURRENT_TIMESTAMP(), '{note}')"
        )
    
    # INSERT 文で新規データを追加
    insert_sql = f"""
    INSERT INTO `{bq_loader.dataset_ref}.dish_category_features_catalog`
    (item_qid, feature_type, feature_key, score, source, run_id, updated_at, note)
    VALUES
    {', '.join(values_list)}
    """
    
    affected = bq_loader.execute_dml(insert_sql)
    logger.info(f"INSERT completed: {affected} rows inserted")
    
    # #557 【設計】過分削除は不要（既に DELETE で全削除済み）
    logger.info("=" * 80)
    logger.info("Summary:")
    logger.info(f"  - Deleted old entries: {deleted_old} rows")
    logger.info(f"  - Inserted new entries: {affected} rows")
    logger.info("=" * 80)


def main():
    """メイン処理"""
    parser = argparse.ArgumentParser(
        description="Apply region LLM results to dish_category_features_catalog"
    )
    parser.add_argument(
        "--market",
        required=True,
        choices=["scope:global", "country:JP"],
        help="Target market (scope:global or country:JP)"
    )
    parser.add_argument(
        "--run_id",
        required=True,
        help="Run ID for this batch (e.g., 20251218T0000_global_v1)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Dry run mode (no actual changes)"
    )
    
    args = parser.parse_args()
    market = args.market
    run_id = args.run_id
    dry_run = args.dry_run
    
    logger.info("=" * 80)
    logger.info("Step 1-4: Applying region LLM results to features catalog")
    logger.info("=" * 80)
    logger.info(f"Market: {market}")
    logger.info(f"Run ID: {run_id}")
    logger.info(f"Dry run: {dry_run}")
    
    # BigQuery Loader 初期化
    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    # LLM 統計を取得
    allow_high = get_llm_statistics(bq_loader, market, run_id)
    
    if allow_high == 0:
        logger.warning("No allow+high items found. Nothing to apply.")
        return
    
    # dish_category_features_catalog に反映
    apply_to_features_catalog(bq_loader, market, run_id, dry_run)
    
    logger.info("=" * 80)
    logger.info("✅ Step 1-4 completed successfully!")
    logger.info("=" * 80)
    
    if not dry_run:
        logger.info("")
        logger.info("Region gate features have been applied to dish_category_features_catalog.")
        logger.info("You can now use these features for the recommendation API gate logic.")


if __name__ == "__main__":
    main()
