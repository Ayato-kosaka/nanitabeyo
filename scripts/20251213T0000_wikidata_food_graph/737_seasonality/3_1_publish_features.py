#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_1_publish_features.py

【目的】
#737 approve された季節曲線を dish_category_features_catalog へ MERGE する

【投入される形】
- feature_type = 'season'
- feature_key  = '<region_scope>:month:MM'（例: 'region:country:JP:month:08'）
- score        = LEAST(index_value, 1.0)   ※ 1.0 = 平常（＝補正係数がちょうど 1.0）
- source       = 'wikipedia_pageviews'

approve された 1 カテゴリにつき 12 行（1〜12 月）入る。

【この後】
9_2_sync_dish_category_features.py --schema dev で PostgreSQL へ同期する
（全置換なので migration は不要）。**dev への同期もオーナー承認が要る。**

【使用方法】
python3 3_1_publish_features.py --run-id 20260825T0000 --dry-run
python3 3_1_publish_features.py --run-id 20260825T0000
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import load_yaml_config

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Publish season features")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    bq_client = BigQueryClient()
    region_scope = config["region_scope"]

    logger.info("=" * 80)
    logger.info("Step 3-1: Publish season features")
    logger.info("=" * 80)
    logger.info(f"run_id: {args.run_id} / region_scope: {region_scope}")

    # ── プレビュー: 何が入るのか（8 月と 12 月の score を並べて効き方を見る）──
    preview = f"""
    WITH latest_review AS (
      SELECT * EXCEPT(rn) FROM (
        SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.item_qid ORDER BY r.created_at DESC) rn
        FROM `{config['dataset']}.dish_category_seasonality_review` r
        WHERE r.run_id = '{args.run_id}'
      ) WHERE rn = 1
    )
    SELECT
      c.item_qid,
      ANY_VALUE(cat.label_ja) AS label_ja,
      ROUND(MAX(IF(c.month = 8, LEAST(c.index_value, 1.0), NULL)), 2) AS score_aug,
      ROUND(MAX(IF(c.month = 12, LEAST(c.index_value, 1.0), NULL)), 2) AS score_dec,
      ROUND(ANY_VALUE(c.amplitude), 2) AS amplitude
    FROM `{config['dataset']}.dish_category_seasonality_curve` c
    JOIN latest_review v ON v.item_qid = c.item_qid AND v.decision = 'approve'
    LEFT JOIN `{config['dataset']}.dish_category_catalog` cat ON cat.item_qid = c.item_qid
    WHERE c.run_id = '{args.run_id}'
    GROUP BY c.item_qid
    ORDER BY score_aug
    """

    rows = list(bq_client.execute_query(preview))
    if not rows:
        raise SystemExit(
            f"run_id={args.run_id} に approve された曲線がありません。"
            "2_2 を先に実行してください（空の MERGE を黙って通さないため中断します）。"
        )

    logger.info(f"投入対象: {len(rows)} カテゴリ × 12 か月 = {len(rows) * 12} 行")
    logger.info("  料理            8月score  12月score  振幅")
    for row in rows:
        logger.info(
            f"  {str(row.get('label_ja') or row.get('item_qid')):<14} "
            f"{row.get('score_aug')}      {row.get('score_dec')}      {row.get('amplitude')}x"
        )

    if args.dry_run:
        logger.info("Dry run: MERGE は実行しない")
        logger.info("✅ Step 3-1 (dry-run) completed")
        return

    sql_path = Path(__file__).parent / "sql" / "publish_features.sql"
    bq_client.execute_merge(
        sql_path.read_text(encoding="utf-8"),
        {
            "DATASET": config["dataset"],
            "RUN_ID": args.run_id,
            "REGION_SCOPE": region_scope,
            "TASK": config["task"],
        },
    )

    verify = f"""
    SELECT COUNT(*) AS rows_count, COUNT(DISTINCT item_qid) AS items
    FROM `{config['dataset']}.dish_category_features_catalog`
    WHERE feature_type = 'season'
      AND STARTS_WITH(feature_key, '{region_scope}:month:')
    """
    for row in bq_client.execute_query(verify):
        logger.info(
            f"投入後の season 行: {row.get('rows_count')} 行 / {row.get('items')} カテゴリ"
        )

    logger.info("=" * 80)
    logger.info("✅ Step 3-1 completed")
    logger.info("")
    logger.info("次: PostgreSQL dev へ同期（**オーナー承認が要る**）")
    logger.info("  9_2_sync_dish_category_features.py --schema dev --dry-run")
    logger.info("  9_2_sync_dish_category_features.py --schema dev")


if __name__ == "__main__":
    main()
