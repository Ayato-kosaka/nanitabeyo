#!/usr/bin/env python3
"""#1273 SNS seed パイプラインの BigQuery テーブルを作成する。

`infra/big-query/migration/20260830T0000_create_sns_seed_tables.sql` を適用する。
migration 冒頭で旧 sns_* を DROP して作り直すため、再実行は冪等（＝クリーンな作り直し）。
Dataset は restaurant_recommendation（店提案基盤と同居）。
"""

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
    / "20260830T0000_create_sns_seed_tables.sql"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="SNS seed 用テーブルを作成する（旧 sns_* を DROP→再作成）"
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    parse_args()
    pipeline = BigQueryPipeline()

    # Dataset は明示的なインフラ境界。誤字 Dataset への作成事故を避けるため暗黙作成しない。
    try:
        pipeline.client.get_dataset(pipeline.dataset_ref)
    except NotFound as error:
        raise RuntimeError(
            f"Dataset {pipeline.dataset_ref} がありません。"
            "先に restaurant_recommendation Dataset を用意してください。"
        ) from error

    LOGGER.info("SNS seed migration を適用します（DROP→CREATE）: %s", MIGRATION)
    pipeline.execute_sql_file(MIGRATION)
    LOGGER.info("SNS seed テーブルを作成しました: %s", pipeline.dataset_ref)


if __name__ == "__main__":
    main()
