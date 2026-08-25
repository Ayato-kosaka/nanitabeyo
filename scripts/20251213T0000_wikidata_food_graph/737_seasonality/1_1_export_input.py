#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_1_export_input.py

【目的】
#737 season の対象記事リストを作る（gate 通過カテゴリ × 言語版の記事タイトル）

【処理内容】
1. sql/export_input.sql で gate 通過カテゴリを取得
2. sitelinks_json から対象言語版の記事タイトルを取り出す
3. 記事が無いものは `label_ja` を候補として書き出す（fallback フラグ付き）

【sitelink が無いカテゴリについて】
実測では 134 件中 12 件が ja.wikipedia の sitelink を持たない。しかもその中に
**最も夏向きの「かき氷」が含まれる**（gate を通っている QID が Q7491078 = shaved ice で、
ja 版のリンクが無い。「かき氷」という記事自体は存在し、別に引けば 7.4 倍の振幅が取れる）。
そこで label_ja を記事名の候補として出し、`article_source='label_fallback'` を立てる。
**当たった記事が本当にその料理かは人が見る**（2_1 のレビュー対象に必ず含まれる）。

【使用方法】
python3 1_1_export_input.py
python3 1_1_export_input.py --config config.yml
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bq import BigQueryClient
from lib.io import ensure_directory, load_yaml_config, write_jsonl
from lib.pageviews import parse_wiki_article

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Export seasonality input list")
    parser.add_argument("--config", type=str, default="config.yml")
    args = parser.parse_args()

    config = load_yaml_config(Path(__file__).parent / args.config)

    logger.info("=" * 80)
    logger.info("Step 1-1: Export seasonality input")
    logger.info("=" * 80)

    sql_path = Path(__file__).parent / "sql" / "export_input.sql"
    query = sql_path.read_text(encoding="utf-8")

    bq_client = BigQueryClient()
    rows = bq_client.execute_query(query, {"DATASET": config["dataset"]})

    wiki_host = config["wiki_host"]
    items = []
    fallback_count = 0
    missing_count = 0

    for row in rows:
        article = parse_wiki_article(row.get("sitelinks_json"), wiki_host)
        article_source = "sitelink"

        if not article:
            # sitelink が無い。label_ja を記事名の候補にする（人が確認する前提）
            article = row.get("label_ja")
            article_source = "label_fallback"
            fallback_count += 1

        if not article:
            # label_ja も無い＝手がかりが無い。黙って落とさずログに出す
            missing_count += 1
            logger.warning(
                f"no article candidate: {row.get('item_qid')} "
                f"({row.get('label_en')})"
            )
            continue

        items.append(
            {
                "item_qid": row.get("item_qid"),
                "label_ja": row.get("label_ja"),
                "label_en": row.get("label_en"),
                "wiki": config["wiki_project"],
                "article": article,
                "article_source": article_source,
            }
        )

    work_dir = Path(config["work_dir"])
    ensure_directory(work_dir)
    output_path = work_dir / "input.jsonl"
    write_jsonl(items, output_path, force=True)

    logger.info(f"対象: {len(items)} 件")
    logger.info(f"  sitelink から取得: {len(items) - fallback_count} 件")
    logger.info(f"  label_ja へフォールバック: {fallback_count} 件（人の確認が必須）")
    logger.info(f"  記事名の手がかり無しで除外: {missing_count} 件")
    logger.info(f"出力: {output_path}")
    logger.info("=" * 80)
    logger.info("✅ Step 1-1 completed")


if __name__ == "__main__":
    main()
