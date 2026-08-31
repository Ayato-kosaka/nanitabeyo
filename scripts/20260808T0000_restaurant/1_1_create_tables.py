#!/usr/bin/env python3
"""店提案用 BigQuery テーブルを作成する。"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from google.api_core.exceptions import NotFound

from pipeline_common import BigQueryPipeline, configure_logging

LOGGER = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    REPO_ROOT
    / "infra"
    / "big-query"
    / "migration"
    / "20260812T0000_create_restaurant_recommendation_tables.sql"
)


def parse_args() -> argparse.Namespace:
    """引数が無いstepでも、`--help`を実行と誤認しない共通CLI境界を持つ。"""

    parser = argparse.ArgumentParser(
        description="restaurant_recommendation Datasetのテーブルを作成します"
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    parse_args()
    pipeline = BigQueryPipeline()

    # Datasetは明示的なインフラ境界なので、ここで暗黙作成しない。誤字のDatasetへ
    # テーブルを作る事故を避け、setup scriptを先に実行してもらう。
    try:
        pipeline.client.get_dataset(pipeline.dataset_ref)
    except NotFound as error:
        raise RuntimeError(
            f"Dataset {pipeline.dataset_ref} がありません。"
            "infra/big-query/20260812T0000_setup_restaurant_recommendation_dataset.sh "
            "を先に実行してください。"
        ) from error

    LOGGER.info("BigQuery migrationを実行します: %s", MIGRATION)
    pipeline.execute_sql_file(MIGRATION)
    LOGGER.info("店提案用テーブルを作成しました: %s", pipeline.dataset_ref)


if __name__ == "__main__":
    main()
