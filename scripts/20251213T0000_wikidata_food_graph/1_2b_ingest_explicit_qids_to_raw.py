#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1_2b_ingest_explicit_qids_to_raw.py

【目的】
人手で確認した Wikidata QID を、BigQuery の `food_nodes_raw` に明示的に補充する。

このスクリプトは通常の graph 取得ルートである `1_2_fetch_and_load_nodes.py` の代替ではない。
責務はかなり狭く、次の一点だけに限定する。

  - 指定された QID の label/description を Wikidata から取得する
  - 既存の staging + MERGE 経路を使って `food_nodes_raw` に upsert する

【このスクリプトが「しない」こと】
責務の境界を誤ると後続テーブルを壊しやすいため、明示しておく。

  - `food_roots` は変更しない
    food_roots は取得起点 root の定義であり、普通の料理 QID の whitelist ではない。
    料理 QID を root に入れると、その下位 item まで取得されて候補集合が膨らむ。

  - `food_paths` / `dish_root_summary` / `dish_blacklist` は更新しない
    既存の `1_3_generate_paths_and_summary.py` は food_paths を TRUNCATE して再生成する。
    追加 QID だけの edge で走らせると、既存 graph を部分データで上書きするリスクがある。

  - 「料理として本番採用してよいか」は判断しない
    raw は原票であり、採用判定は blacklist、catalog、feature、localized text など後続工程の責務。

【使い方】

  # QID を引数で渡す
  python3 1_2b_ingest_explicit_qids_to_raw.py \\
    --qid Q117231375 --qid Q1193068 --qid Q140431305 --qid Q30022

  # ファイルから読む。空行と # コメント行は無視する
  python3 1_2b_ingest_explicit_qids_to_raw.py --qids-file /tmp/qids.txt

  # BigQuery には書かず、Wikidata から取れる内容だけ確認する
  python3 1_2b_ingest_explicit_qids_to_raw.py --qids-file /tmp/qids.txt --dry-run

【注意】
既存の `load_food_nodes_to_staging()` は staging テーブルを WRITE_TRUNCATE する。
その後すぐ MERGE するため本用途では問題ないが、同じ staging テーブルを使う別ジョブと
同時実行しないこと。
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import List, Set

from wikidata_client import WikidataClient


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"


def read_qids_from_file(path: Path) -> List[str]:
    """
    QID リストファイルを読み込む。

    ファイルは運用時に手で作ることが多い想定なので、少し緩く扱う。
    - 空行は無視する
    - `#` で始まる行はコメントとして無視する
    - 行末コメントは扱わない。QID だけを 1 行に 1 つ書く
    """
    qids: List[str] = []

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            value = line.strip()
            if not value or value.startswith("#"):
                continue
            qids.append(value)

    return qids


def normalize_qids(raw_qids: List[str]) -> List[str]:
    """
    入力 QID を validation + dedupe して、実行順を安定させる。

    ここでは「Q + 数字」以外を落とすだけにする。
    料理かどうか、Wikidata item として存在するかはこの段階では判断しない。
    存在確認は Wikidata SPARQL 側で行い、存在しなかったものは取得件数差分として警告する。
    """
    normalized: List[str] = []
    seen: Set[str] = set()

    for qid in raw_qids:
        value = qid.strip()
        if not (value.startswith("Q") and value[1:].isdigit()):
            logger.warning("Skipping invalid QID: %r", qid)
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)

    return sorted(normalized, key=lambda q: int(q[1:]))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest explicit Wikidata QIDs into BigQuery food_nodes_raw"
    )
    parser.add_argument(
        "--qid",
        action="append",
        default=[],
        help="Wikidata QID to ingest. Can be specified multiple times.",
    )
    parser.add_argument(
        "--qids-file",
        type=Path,
        help="Path to a text file containing one QID per line.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch from Wikidata and print summary, but do not write BigQuery.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    raw_qids: List[str] = list(args.qid)

    if args.qids_file:
        if not args.qids_file.exists():
            logger.error("QID file not found: %s", args.qids_file)
            sys.exit(1)
        raw_qids.extend(read_qids_from_file(args.qids_file))

    qids = normalize_qids(raw_qids)

    if not qids:
        logger.error("No QIDs provided. Use --qid or --qids-file.")
        sys.exit(1)

    logger.info("=" * 80)
    logger.info("Ingesting explicit QIDs to food_nodes_raw")
    logger.info("=" * 80)
    logger.info("Project: %s, Dataset: %s", GCP_PROJECT, BQ_DATASET)
    logger.info("Input QIDs: %d", len(qids))

    wikidata_client = WikidataClient()
    nodes = wikidata_client.fetch_nodes_by_qids(qids)

    fetched_qids = {node["item_qid"] for node in nodes}
    missing_qids = [qid for qid in qids if qid not in fetched_qids]

    if missing_qids:
        logger.warning(
            "Some QIDs were not returned by Wikidata and will not be loaded: %s",
            ", ".join(missing_qids),
        )

    if not nodes:
        logger.error("No nodes fetched from Wikidata. Nothing to load.")
        sys.exit(1)

    logger.info("Fetched nodes: %d", len(nodes))
    for node in nodes:
        logger.info(
            "  %s label_ja=%r label_en=%r",
            node["item_qid"],
            node.get("label_ja"),
            node.get("label_en"),
        )

    if args.dry_run:
        logger.info("Dry run requested. BigQuery was not modified.")
        return

    # 既存の production path と同じ staging + MERGE を使う。
    # これにより、直接 INSERT/MERGE SQL をこの補助スクリプトに重複実装しない。
    # staging は WRITE_TRUNCATE されるため、同じ staging を使う job と同時実行しないこと。
    #
    # BigQuery import はここで遅延させる。
    # dry-run は Wikidata 取得結果の確認だけを目的にしているため、
    # google-cloud-bigquery が未インストールのローカル環境でも動かせるようにする。
    from loader_bigquery import BigQueryLoader

    bq_loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)

    logger.info("Loading explicit nodes to food_nodes_raw_staging...")
    bq_loader.load_food_nodes_to_staging(nodes)

    logger.info("Merging explicit nodes from staging to food_nodes_raw...")
    merge_result = bq_loader.merge_food_nodes_from_staging()

    logger.info("=" * 80)
    logger.info("Explicit QID ingest completed")
    logger.info("=" * 80)
    logger.info("Before: %d distinct QIDs", merge_result["before_count"])
    logger.info("After: %d distinct QIDs", merge_result["after_count"])
    logger.info("Affected rows: %d", merge_result["affected_rows"])
    logger.info("")
    logger.info("Next recommended check:")
    logger.info("  Re-run the BigQuery progress SQL and confirm in_food_nodes_raw=true.")


if __name__ == "__main__":
    main()
