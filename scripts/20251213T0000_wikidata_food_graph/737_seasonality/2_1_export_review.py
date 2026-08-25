#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2_1_export_review.py

【目的】
#737 レビュー対象の季節曲線を、人が読める形で書き出す

【なぜレビューが要るのか】
134 件を全件処理した実測で、**機械的に採用すると壊れる例**が出た。

| 項目 | 出た結果 | 実際は |
|---|---|---|
| カフェ | ピーク 9 月 1.91x | 記事は業態の解説。外食需要と無関係 |
| 和食 / 懐石料理 | 11 月 / 5 月 | 「和食の日(11/24)」等の記事都合 |
| 餃子 | 振幅 2.04x | sitelink が「日本の餃子」(640PV) を指していた。本体の「餃子」(7,858PV) は 1.3x で平坦 |
| チーズタッカルビ | 冬型 | 月 14PV。統計として成立していない |

閾値（振幅・PV・観測月数）で 31 件程度まで絞れるので、そこは人が見る。
判定の観点は README の「レビューの判断基準」にある。

【出力】
- review_input.jsonl : 2_2 へ渡す機械可読な形（decision を空で出す）
- review_input.md    : 人が読むための表（12 か月の指数を並べたもの）

【使用方法】
python3 2_1_export_review.py --run-id 20260825T0000
python3 2_1_export_review.py --run-id 20260825T0000 --all   # 閾値を無視して全件出す
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import ensure_directory, load_yaml_config, write_jsonl

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Export seasonality review sheet")
    parser.add_argument("--config", type=str, default="config.yml")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--all", action="store_true", help="needs_review 以外も出す")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)
    bq_client = BigQueryClient()

    where_review = "" if args.all else "AND c.needs_review"
    query = f"""
    SELECT
      c.item_qid,
      ANY_VALUE(cat.label_ja) AS label_ja,
      ANY_VALUE(cat.label_en) AS label_en,
      ANY_VALUE(c.article) AS article,
      ANY_VALUE(c.wiki) AS wiki,
      ANY_VALUE(c.amplitude) AS amplitude,
      ANY_VALUE(c.monthly_pv_mean) AS monthly_pv_mean,
      ANY_VALUE(c.months_observed) AS months_observed,
      ANY_VALUE(c.quality_flag) AS quality_flag,
      ARRAY_AGG(ROUND(c.index_value, 2) ORDER BY c.month) AS index_by_month
    FROM `{config['dataset']}.dish_category_seasonality_curve` c
    LEFT JOIN `{config['dataset']}.dish_category_catalog` cat
      ON cat.item_qid = c.item_qid
    WHERE c.run_id = '{args.run_id}' {where_review}
    GROUP BY c.item_qid
    ORDER BY ANY_VALUE(c.amplitude) DESC
    """

    rows = list(bq_client.execute_query(query))
    if not rows:
        raise SystemExit(
            f"run_id={args.run_id} にレビュー対象がありません。"
            "1_3 を実行したか、閾値が厳しすぎないか確認してください。"
        )

    work_dir = Path(config["work_dir"])
    ensure_directory(work_dir)

    items = []
    for row in rows:
        idx = list(row.get("index_by_month") or [])
        items.append(
            {
                "item_qid": row.get("item_qid"),
                "label_ja": row.get("label_ja"),
                "label_en": row.get("label_en"),
                "article": row.get("article"),
                "amplitude": round(float(row.get("amplitude") or 0), 2),
                "monthly_pv_mean": round(float(row.get("monthly_pv_mean") or 0)),
                "months_observed": row.get("months_observed"),
                "index_by_month": idx,
                # ここを人（＋Claude Code の下書き）が埋める
                "decision": "",
                "reason": "",
            }
        )

    jsonl_path = work_dir / f"review_input_{args.run_id}.jsonl"
    write_jsonl(items, jsonl_path, force=True)

    # 人が読む用。12 か月を横に並べないと「形が変かどうか」が判断できない
    md_lines = [
        f"# #737 季節曲線レビュー（run_id: {args.run_id}）",
        "",
        "各月の値は「その月の閲覧数 ÷ 全期間の平均」。1.00 = 平常月。",
        "",
        "| 料理 | 記事 | " + " | ".join(f"{m}月" for m in range(1, 13)) + " | 振幅 | 月PV |",
        "|---|---|" + "---|" * 12 + "---|---|",
    ]
    for it in items:
        cells = " | ".join(f"{v:.2f}" for v in it["index_by_month"]) if it["index_by_month"] else ""
        md_lines.append(
            f"| {it['label_ja'] or it['label_en']} | {it['article']} | {cells} | "
            f"{it['amplitude']}x | {it['monthly_pv_mean']:,} |"
        )
    md_path = work_dir / f"review_input_{args.run_id}.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    logger.info(f"レビュー対象: {len(items)} 件")
    logger.info(f"  機械可読: {jsonl_path}")
    logger.info(f"  人が読む用: {md_path}")
    logger.info("")
    logger.info("次: 各行の decision を 'approve' / 'reject' に、reason を日本語で埋めて")
    logger.info("    2_2_apply_review.py へ渡す（reason が空の行は弾かれる）")


if __name__ == "__main__":
    main()
