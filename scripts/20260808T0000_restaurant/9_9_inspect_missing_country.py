#!/usr/bin/env python3
"""国コードが引けない行を 1 件ずつ中身ごと出す（読み取り専用）。

`9_9_audit_country_code.py` が «引けない» と数えた行が、なぜ引けないのかを見る。
`country_code` を NOT NULL にできるかはこの行の性質で決まるので、件数だけでなく
**中身**を見ないと «埋められるのか / 諦めるのか» を決められない。

想定される理由:
  1. address_components が `[]`（同期に上書きされた等）
  2. address_components が配列でない（jsonb の NOT NULL は配列を保証しない）
  3. 配列だが country の要素が無い（Google が返さなかった）
  4. country はあるが shortText が無い

どれなのかで手当てが変わる。1 なら復元、3・4 なら座標から補える。
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

COUNTRY_EXPR = """
  (SELECT elem->>'shortText'
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(address_components) = 'array'
            THEN address_components ELSE '[]'::jsonb END) AS elem
    WHERE elem->'types' ? 'country'
    LIMIT 1)
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="国コードが引けない行を調べます（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id::text, google_place_id, name, created_by_source,
                       latitude, longitude, created_at,
                       jsonb_typeof(address_components) AS ac_type,
                       CASE WHEN jsonb_typeof(address_components) = 'array'
                            THEN jsonb_array_length(address_components) END AS ac_len,
                       LEFT(address_components::text, 400) AS ac_head,
                       source_seed_id IS NOT NULL AS has_seed
                FROM restaurants
                WHERE {COUNTRY_EXPR} IS NULL
                ORDER BY created_at
                LIMIT %s
                """,
                (args.limit,),
            )
            rows = cursor.fetchall()
            LOGGER.info("国コードが引けない行: %d件（先頭 %d 件を表示）", len(rows), args.limit)
            for r in rows:
                LOGGER.info("")
                LOGGER.info("  id            : %s", r[0])
                LOGGER.info("  google_place_id: %s", r[1])
                LOGGER.info("  name          : %r", r[2])
                LOGGER.info("  created_by    : %s / seed: %s", r[3], "あり" if r[10] else "なし")
                LOGGER.info("  座標          : %s, %s", r[4], r[5])
                LOGGER.info("  created_at    : %s", r[6])
                LOGGER.info("  address_components: type=%s len=%s", r[7], r[8])
                LOGGER.info("  中身(先頭400字): %s", r[9])
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
