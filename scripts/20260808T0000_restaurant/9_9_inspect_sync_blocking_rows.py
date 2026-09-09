#!/usr/bin/env python3
"""#1881 `9_1` の事前検査が止めている行が «誰の行か» を見る（読み取り専用）。

## なぜ要るか

2026-09-09、承認をもらった同期の dry run が止まった。

    RuntimeError: 過去の同期が作った行のうち1件が created_by_source='pipeline' に
    なっていません。9_9_backfill_created_by_source.py を先に実行してください

⚠️ **この «先に実行してください» に従ってはいけない。**

`9_9_backfill_created_by_source.py` 自身が、その状況をこう書いている:

> 新しい 9_1 が流れた後に実行すると、**同期中に作られたユーザーの行を pipeline へ
> 誤って書き換えます**。実行しません

つまり案内されたスクリプトは（dev には既に pipeline の行が 61 万件あるので）
**実行を拒否する**。仮に動いたとしても、ユーザーの店を同期の上書き対象へ
落とす操作である（#1643 で止血した事故そのもの）。

## 何を見るのか

`9_1` が数えているのと **同じ条件**で、止めている行そのものを出す。

    created_by_source <> 'pipeline'
    AND source_seed_id IS NOT NULL
    AND created_at BETWEEN <同期の窓>

backfill script の注記どおり、この条件は
«同期の実行中にユーザーが店を作り、pipeline の INSERT が ON CONFLICT で弾かれ、
直後の provenance UPDATE がそのユーザー製の行へ source_seed_id を刻んだ»
ケースを拾う。**つまり «過去の同期が作った行» とは限らない。**

その行が本当にユーザー製なら、`9_1` の事前検査の方が間違っている。
**どちらなのかを、推測ではなく行を見て決める。**

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

実行:
    python3 scripts/20260808T0000_restaurant/9_9_inspect_sync_blocking_rows.py --schema dev
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# ⚠️ 9_1 の validate_staging と **同じ条件**であること。ここがずれると別の行を見る。
BLOCKING_ROWS_SQL = """
  SELECT
      r.id::text,
      r.name,
      r.created_by_source,
      r.source_seed_id,
      r.created_at,
      -- ⚠️ restaurants に updated_at は無い。同期が触ったかは synced_at で見る
      r.synced_at,
      r.google_place_id,
      r.country_code,
      r.source_row_hash,
      array_length(r.source_names, 1) AS source_name_count
  FROM restaurants r
  WHERE r.created_by_source <> 'pipeline'
    AND r.source_seed_id IS NOT NULL
  ORDER BY r.created_at
  LIMIT 50
"""

SOURCE_BREAKDOWN_SQL = """
  SELECT created_by_source, COUNT(*) AS rows
  FROM restaurants
  GROUP BY 1
  ORDER BY 2 DESC
"""


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    args = parser.parse_args()

    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = on")
            cursor.execute(SOURCE_BREAKDOWN_SQL)
            breakdown = cursor.fetchall()
            cursor.execute(BLOCKING_ROWS_SQL)
            rows = cursor.fetchall()
    finally:
        connection.close()

    LOGGER.info("=" * 78)
    LOGGER.info("# 9_1 の事前検査が止めている行（schema=%s）", args.schema)
    LOGGER.info("=" * 78)
    LOGGER.info("")
    LOGGER.info("## created_by_source の分布")
    for source, count in breakdown:
        LOGGER.info("  %-24s : %10s 行", source, f"{count:,}")

    LOGGER.info("")
    LOGGER.info("## created_by_source <> 'pipeline' なのに source_seed_id を持つ行")
    LOGGER.info("   ⚠️ これがユーザー製なら、backfill は «ユーザーの店を同期へ差し出す» ことになる")
    if not rows:
        LOGGER.info("  該当なし")
    for (
        rid,
        name,
        source,
        seed_id,
        created_at,
        synced_at,
        place_id,
        country,
        row_hash,
        source_name_count,
    ) in rows:
        LOGGER.info("  ─" * 20)
        LOGGER.info("  id            : %s", rid)
        LOGGER.info("  name          : %s", name)
        LOGGER.info("  created_by    : %s", source)
        LOGGER.info("  source_seed_id: %s", seed_id)
        LOGGER.info("  created_at    : %s", created_at)
        LOGGER.info("  synced_at     : %s  (同期が触った形跡: %s)", synced_at, synced_at is not None)
        LOGGER.info("  google_place_id: %s", place_id)
        LOGGER.info("  country_code  : %s", country)
        LOGGER.info("  source_row_hash: %s", row_hash)
        LOGGER.info("  source_names の数: %s", source_name_count)
    LOGGER.info("")
    LOGGER.info("合計 %d 行", len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
