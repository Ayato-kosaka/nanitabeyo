#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_upsert_localized_text.py

【目的】(#737)
人がレビュー済みの topic_title / tagline を `dish_category_localized_text_catalog` へ
差し替える。LLM バッチ（1_x / 2_x）を回さずに、少数の文言だけを直すための運用スクリプト。

【なぜ要るのか】
`鍋料理` の tagline は `source='manual' run_id='20260222T0000_#727'` で入っているが、
**再現できるスクリプトが残っていない**（アドホックな SQL で入れられたとみられる）。
同じことがまた起きるので、ここで手順を残す。

【差し替えの対象になる文言】
#737 の季節補正では、ランキングを直しても文言が季節に固定されていると
「稀に出たときに 8 月なのに『冬のご褒美』と出る」という形で残る。
gate 通過 134 件を季節語で全数走査した結果、直すべきは 1〜2 件だけだった。

【保存形式】
source          = 'manual'
selected_run_id = --run-id で指定した値（監査用。LLM run と区別するため偽装しない）
note            = 変更理由（必須）

【使用方法】
# 単一行
python3 manual/1_upsert_localized_text.py \\
  --run-id "20260825T0000_#737" \\
  --item-qid Q1962004 --locale ja \\
  --tagline "煮えた具をすくって口に入れた瞬間、熱とだしの旨みが一気に広がる。" \\
  --note "#737 8月に『冬のご褒美』と出るため季節の名指しを外す" \\
  --dry-run

# 複数行（JSONL。1行1件。キー: item_qid / locale / topic_title? / tagline? / note）
python3 manual/1_upsert_localized_text.py \\
  --run-id "20260825T0000_#737" --input-jsonl /tmp/localized.jsonl --dry-run

--dry-run を外すと実 MERGE を行う。
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from google.cloud import bigquery

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

DATASET = "food-scroll.wikidata_food_graph"
CATALOG_TABLE = f"{DATASET}.dish_category_localized_text_catalog"


def load_updates(args) -> list:
    """CLI 引数 or JSONL から更新内容を読む"""
    if args.input_jsonl:
        rows = []
        for line in Path(args.input_jsonl).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
        return rows

    if not args.item_qid or not args.locale:
        raise SystemExit("--item-qid と --locale、または --input-jsonl が必要です")
    return [
        {
            "item_qid": args.item_qid,
            "locale": args.locale,
            "topic_title": args.topic_title,
            "tagline": args.tagline,
            "note": args.note,
        }
    ]


def validate(updates: list, client: bigquery.Client) -> None:
    """
    すべて通らないと 1 件も反映しない。

    - item_qid / locale が空でない
    - topic_title か tagline のどちらかは指定されている（両方 None は無意味）
    - note が空でない（「なぜ直したか」の無い変更を残さない）
    - 対象行が catalog に実在する（新規作成はこのスクリプトの責務ではない）
    """
    errors = []
    for i, u in enumerate(updates, 1):
        if not (u.get("item_qid") or "").strip():
            errors.append(f"{i} 行目: item_qid が空")
        if not (u.get("locale") or "").strip():
            errors.append(f"{i} 行目: locale が空")
        if not (u.get("topic_title") or u.get("tagline")):
            errors.append(f"{i} 行目: topic_title / tagline のどちらも指定されていない")
        if not (u.get("note") or "").strip():
            errors.append(f"{i} 行目: note が空。変更理由の無い差し替えは受け付けません")

    if errors:
        for e in errors:
            logger.error(f"  - {e}")
        raise SystemExit(1)

    keys = {(u["item_qid"], u["locale"]) for u in updates}
    where = " OR ".join(
        f"(item_qid = '{q}' AND locale = '{l}')" for q, l in sorted(keys)
    )
    found = {
        (row.item_qid, row.locale)
        for row in client.query(
            f"SELECT item_qid, locale FROM `{CATALOG_TABLE}` WHERE {where}"
        ).result()
    }
    missing = keys - found
    if missing:
        for q, l in sorted(missing):
            logger.error(f"  - {q} / {l} が catalog に存在しません（新規作成はしません）")
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description="Upsert localized text (manual)")
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--item-qid", type=str)
    parser.add_argument("--locale", type=str)
    parser.add_argument("--topic-title", type=str)
    parser.add_argument("--tagline", type=str)
    parser.add_argument("--note", type=str)
    parser.add_argument("--input-jsonl", type=str)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    updates = load_updates(args)
    client = bigquery.Client(project="food-scroll")

    logger.info("=" * 80)
    logger.info("manual: upsert localized text")
    logger.info("=" * 80)
    logger.info(f"run_id: {args.run_id} / 対象 {len(updates)} 件")

    validate(updates, client)

    # before を出す。差し替えは元の文言が分からないと妥当性を判断できない
    for u in updates:
        rows = list(
            client.query(
                f"SELECT topic_title, tagline, source, selected_run_id "
                f"FROM `{CATALOG_TABLE}` "
                f"WHERE item_qid = '{u['item_qid']}' AND locale = '{u['locale']}'"
            ).result()
        )
        before = rows[0]
        logger.info(f"[{u['item_qid']} / {u['locale']}] {u['note']}")
        logger.info(f"  before topic_title: {before.topic_title}")
        logger.info(f"  before tagline    : {before.tagline}")
        logger.info(f"  before source     : {before.source} ({before.selected_run_id})")
        logger.info(f"  after  topic_title: {u.get('topic_title') or '(据え置き)'}")
        logger.info(f"  after  tagline    : {u.get('tagline') or '(据え置き)'}")

    if args.dry_run:
        logger.info("Dry run: 更新しません")
        return

    # 指定されていないフィールドは既存値を残す（COALESCE ではなく明示的に分岐する）
    for u in updates:
        sets = []
        params = [
            bigquery.ScalarQueryParameter("qid", "STRING", u["item_qid"]),
            bigquery.ScalarQueryParameter("loc", "STRING", u["locale"]),
            bigquery.ScalarQueryParameter("run_id", "STRING", args.run_id),
            bigquery.ScalarQueryParameter("note", "STRING", u["note"]),
        ]
        if u.get("topic_title"):
            sets.append("topic_title = @topic_title")
            params.append(
                bigquery.ScalarQueryParameter("topic_title", "STRING", u["topic_title"])
            )
        if u.get("tagline"):
            sets.append("tagline = @tagline")
            params.append(
                bigquery.ScalarQueryParameter("tagline", "STRING", u["tagline"])
            )

        query = f"""
        UPDATE `{CATALOG_TABLE}`
        SET {", ".join(sets)},
            source = 'manual',
            selected_run_id = @run_id,
            note = @note,
            updated_at = CURRENT_TIMESTAMP()
        WHERE item_qid = @qid AND locale = @loc
        """
        job = client.query(
            query, job_config=bigquery.QueryJobConfig(query_parameters=params)
        )
        job.result()
        logger.info(f"更新: {u['item_qid']} / {u['locale']} ({job.num_dml_affected_rows} 行)")

    logger.info("=" * 80)
    logger.info("✅ completed")
    logger.info("")
    logger.info("次: PostgreSQL dev へ同期（**オーナー承認が要る**）")
    logger.info("  9_3_sync_dish_category_localized_text.py --schema dev --dry-run")
    logger.info("  9_3_sync_dish_category_localized_text.py --schema dev")


if __name__ == "__main__":
    main()
