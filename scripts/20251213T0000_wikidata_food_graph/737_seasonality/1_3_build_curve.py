#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_3_build_curve.py

【目的】
#737 seasonality_raw の月次ページビューから 12 か月の季節指数を計算する

【処理内容】
1. sql/build_curve.sql を実行（seasonality_curve を CREATE OR REPLACE）
2. 分布のサマリを出す（何件が needs_review になったか）

【使用方法】
python3 1_3_build_curve.py --run-id 20260825T0000 --dry-run
python3 1_3_build_curve.py --run-id 20260825T0000
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
    parser = argparse.ArgumentParser(description="Build seasonality curve")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    bq_client = BigQueryClient()

    logger.info("=" * 80)
    logger.info("Step 1-3: Build seasonality curve")
    logger.info("=" * 80)
    logger.info(
        f"閾値: 振幅 >= {config['min_amplitude']} / "
        f"月PV >= {config['min_monthly_pv']} / "
        f"観測月数 >= {config['min_months_observed']}"
    )

    # 先に raw の件数を見て、空の run_id に対して黙って空の curve を作らないようにする
    count_query = f"""
    SELECT COUNT(*) AS rows_count, COUNT(DISTINCT item_qid) AS items
    FROM `{config['dataset']}.dish_category_seasonality_raw`
    WHERE run_id = '{args.run_id}'
    """
    for row in bq_client.execute_query(count_query):
        rows_count, items = row.get("rows_count"), row.get("items")
    logger.info(f"raw: {rows_count} 行 / {items} カテゴリ")

    if not rows_count:
        raise SystemExit(
            f"run_id={args.run_id} の raw が 0 行です。1_2 を先に実行してください。"
            "（空の curve を黙って作らないため中断します）"
        )

    params = {
        "DATASET": config["dataset"],
        "RUN_ID": args.run_id,
        "MIN_AMPLITUDE": config["min_amplitude"],
        "MIN_MONTHLY_PV": config["min_monthly_pv"],
        "MIN_MONTHS_OBSERVED": config["min_months_observed"],
        "MIN_MONTH_COMPLETENESS_RATIO": config["min_month_completeness_ratio"],
    }

    # 未完成月の検出結果は**必ず出す**。黙って月を捨てると、
    # 後から「なぜこの月の指数が変わったのか」を追えなくなる
    dropped_query = f"""
    WITH raw_src AS (
      SELECT ym, views FROM `{config['dataset']}.dish_category_seasonality_raw`
      WHERE run_id = '{args.run_id}'
    ),
    month_totals AS (SELECT ym, SUM(views) total FROM raw_src GROUP BY ym),
    med AS (SELECT APPROX_QUANTILES(total, 2)[OFFSET(1)] median_total FROM month_totals)
    SELECT t.ym, t.total, ROUND(SAFE_DIVIDE(t.total, m.median_total), 3) AS ratio
    FROM month_totals t CROSS JOIN med m
    WHERE t.total < {config['min_month_completeness_ratio']} * m.median_total
    ORDER BY t.ym
    """
    dropped = list(bq_client.execute_query(dropped_query))
    if dropped:
        logger.warning(f"未完成とみなして除外する月: {len(dropped)} 件")
        for row in dropped:
            logger.warning(
                f"  {row.get('ym')}: 合計 {row.get('total'):,} "
                f"（中央値比 {row.get('ratio')}）"
            )
    else:
        logger.info("未完成とみなす月はありません")

    if args.dry_run:
        logger.info("Dry run: curve は作らない。閾値だけ raw から見積もる")
        # ⚠️ build_curve.sql と**同じ未完成月フィルタ**を掛ける。
        #    ここだけ素の raw を見ると、dry-run の見積もりと本実行の結果がずれる
        preview = f"""
        WITH raw_src AS (
          SELECT item_qid, ym, views FROM `{config['dataset']}.dish_category_seasonality_raw`
          WHERE run_id = '{args.run_id}'
        ),
        month_totals AS (SELECT ym, SUM(views) total FROM raw_src GROUP BY ym),
        med AS (SELECT APPROX_QUANTILES(total, 2)[OFFSET(1)] median_total FROM month_totals),
        usable_months AS (
          SELECT t.ym FROM month_totals t CROSS JOIN med m
          WHERE t.total >= {config['min_month_completeness_ratio']} * m.median_total
        ),
        src AS (SELECT r.* FROM raw_src r JOIN usable_months u USING (ym)),
        per_item AS (SELECT item_qid, AVG(views) m, COUNT(*) n FROM src GROUP BY 1),
        per_month AS (
          SELECT item_qid, CAST(SUBSTR(ym,6,2) AS INT64) mo, AVG(views) mm FROM src GROUP BY 1,2
        ),
        idx AS (
          SELECT p.item_qid, SAFE_DIVIDE(p.mm, NULLIF(i.m,0)) v, i.m, i.n
          FROM per_month p JOIN per_item i USING(item_qid)
        ),
        agg AS (
          SELECT item_qid, ANY_VALUE(m) m, ANY_VALUE(n) n,
                 IFNULL(SAFE_DIVIDE(MAX(v), NULLIF(MIN(v),0)),1.0) amp
          FROM idx GROUP BY 1
        )
        SELECT
          COUNT(*) AS total,
          COUNTIF(n >= {config['min_months_observed']}
                  AND m >= {config['min_monthly_pv']}
                  AND amp >= {config['min_amplitude']}) AS needs_review,
          COUNTIF(amp < {config['min_amplitude']}) AS flat,
          COUNTIF(m < {config['min_monthly_pv']}) AS low_traffic
        FROM agg
        """
        for row in bq_client.execute_query(preview):
            logger.info(
                f"  総数 {row.get('total')} / レビュー対象 {row.get('needs_review')} / "
                f"平坦 {row.get('flat')} / 低PV {row.get('low_traffic')}"
            )
        logger.info("✅ Step 1-3 (dry-run) completed")
        return

    sql_path = Path(__file__).parent / "sql" / "build_curve.sql"
    bq_client.execute_query(sql_path.read_text(encoding="utf-8"), params)

    summary = f"""
    SELECT quality_flag, COUNT(DISTINCT item_qid) AS items
    FROM `{config['dataset']}.dish_category_seasonality_curve`
    WHERE run_id = '{args.run_id}'
    GROUP BY quality_flag ORDER BY items DESC
    """
    logger.info("quality_flag の分布:")
    for row in bq_client.execute_query(summary):
        logger.info(f"  {row.get('quality_flag')}: {row.get('items')} 件")

    logger.info("=" * 80)
    logger.info("✅ Step 1-3 completed")


if __name__ == "__main__":
    main()
