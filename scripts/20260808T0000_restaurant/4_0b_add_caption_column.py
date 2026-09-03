#!/usr/bin/env python3
"""#1273 既存 sns_post_raw に caption / author_name 列を **非破壊で** 追加する。

4_0 の migration は DROP→CREATE で、再実行すると収集済みデータを消す。既に大量の
投稿URLが入っているので、ここは `ALTER TABLE ADD COLUMN IF NOT EXISTS` で列だけ足す
（冪等・データ保持）。migration ファイル側の CREATE にも同じ列を入れてあるので、
次のクリーン作り直しでは最初から揃う。

大量並列 resolve（PR #1805）の土台: 収集時のテキストを caption に保存 → resolve へ
渡すと IG 再取得を skip でき、IG を叩かず好きなだけ並列できる。

使い方（db-script-run.yml）:
  script_path: scripts/20260808T0000_restaurant/4_0b_add_caption_column.py
  requirements_path: scripts/20260808T0000_restaurant/requirements.txt
"""

from __future__ import annotations

import logging

from pipeline_common import BigQueryPipeline, configure_logging
from common_sns import TABLE_POST_RAW

LOGGER = logging.getLogger(__name__)


def main() -> None:
    configure_logging()
    pipeline = BigQueryPipeline()
    table = pipeline.table(TABLE_POST_RAW)
    for col in ("caption", "author_name"):
        sql = f"ALTER TABLE `{table}` ADD COLUMN IF NOT EXISTS {col} STRING"
        LOGGER.info("適用: %s", sql)
        pipeline.client.query(sql, location=pipeline.config.region).result()
    LOGGER.info("sns_post_raw に caption / author_name 列を追加しました（冪等）。")


if __name__ == "__main__":
    main()
