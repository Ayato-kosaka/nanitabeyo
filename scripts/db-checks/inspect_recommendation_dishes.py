#!/usr/bin/env python3
"""#1779 dev の dishes 47,668 行（94.6%）が «誰に書かれたのか» を特定する（読み取り専用）。

## なぜ要るか

#1779 で落とす列を測ったとき、`dishes.data_origin = 'restaurant_recommendation'` が
**dev の 94.6%（47,668 行）**あった。ところが、

- リポジトリの中に **その値を書くコードが 1 行も無い**（API は必ず 'user_or_google'）
- **git 履歴にも無い**（`git log --all -S` が 0 件）
- `scripts/20260808T0000_restaurant/README.md:387` が実行手順として書いている
  `9_2_sync_dishes_and_media.py` は **どのブランチにも存在しない**

CLAUDE.md「見えないものは «無い» ではない」。**書き手が分からないまま列を落とすと、
次に同じ行が増えたときに誰も気づけない。** 何者なのかを先に特定する。

## 出すもの

1. その行に dish_media が付いているか。付いているなら `render_type` と保存先の形
2. 紐づく restaurant の `created_by_source` の内訳
3. 作られた時刻の分布（何回の «実行» に分かれているか）
4. 実物のサンプル

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/inspect_recommendation_dishes.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
    concurrency_group_suffix: readonly-audit
"""

from __future__ import annotations

import argparse
import json
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

WHERE_TARGET = "d.data_origin = 'restaurant_recommendation'"

MEDIA_SQL = f"""
  SELECT
    count(*)                                              AS dishes,
    count(dm.id)                                          AS with_media,
    count(*) FILTER (WHERE dm.render_type = 'stored')     AS media_stored,
    count(*) FILTER (WHERE dm.render_type = 'external_embed') AS media_external,
    count(*) FILTER (WHERE dm.user_id IS NULL)            AS media_without_user
  FROM dishes d
  LEFT JOIN dish_media dm ON dm.dish_id = d.id
  WHERE {WHERE_TARGET}
"""

RESTAURANT_SOURCE_SQL = f"""
  SELECT r.created_by_source, count(*) AS rows
  FROM dishes d
  JOIN restaurants r ON r.id = d.restaurant_id
  WHERE {WHERE_TARGET}
  GROUP BY 1
  ORDER BY 2 DESC
"""

# 「何回の実行に分かれているか」を見る。1 分単位に丸めて、間隔の空きで区切る。
BATCH_SQL = f"""
  SELECT date_trunc('hour', d.created_at) AS hour, count(*) AS rows
  FROM dishes d
  WHERE {WHERE_TARGET}
  GROUP BY 1
  ORDER BY 1
"""

SAMPLE_SQL = f"""
  SELECT d.id, d.category_id, d.created_at, d.synced_at,
         r.name AS restaurant_name, r.created_by_source,
         dm.id AS media_id, dm.render_type, dm.media_path
  FROM dishes d
  JOIN restaurants r ON r.id = d.restaurant_id
  LEFT JOIN dish_media dm ON dm.dish_id = d.id
  WHERE {WHERE_TARGET}
  ORDER BY d.created_at
  LIMIT 10
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

            cur.execute(MEDIA_SQL)
            dishes, with_media, stored, external, media_no_user = cur.fetchone()

            cur.execute(RESTAURANT_SOURCE_SQL)
            restaurant_sources = cur.fetchall()

            cur.execute(BATCH_SQL)
            hours = cur.fetchall()

            cur.execute(SAMPLE_SQL)
            samples = cur.fetchall()

    logger.info("")
    logger.info("=" * 78)
    logger.info("# #1779 data_origin='restaurant_recommendation' の行は何者か")
    logger.info("=" * 78)
    logger.info("対象 dishes（media との結合後の延べ）: %s", f"{dishes:,}")
    logger.info("  dish_media が付いている            : %s", f"{with_media:,}")
    logger.info("    render_type='stored'             : %s", f"{stored:,}")
    logger.info("    render_type='external_embed'     : %s", f"{external:,}")
    logger.info("    user_id が NULL（人ではない）    : %s", f"{media_no_user:,}")

    logger.info("")
    logger.info("## 紐づく restaurant の created_by_source")
    for source, rows in restaurant_sources:
        logger.info("  %-10s : %s", source or "(NULL)", f"{rows:,}")

    logger.info("")
    logger.info("## created_at の分布（時間ごと）")
    for hour, rows in hours:
        logger.info("  %s : %s", hour, f"{rows:,}")

    logger.info("")
    logger.info("## サンプル")
    for row in samples:
        logger.info("  %s", row)

    result = {
        "schema": args.schema,
        "dishes_joined": dishes,
        "with_media": with_media,
        "media_stored": stored,
        "media_external": external,
        "media_without_user": media_no_user,
        "restaurant_created_by_source": {s or "NULL": n for s, n in restaurant_sources},
        "created_at_hours": {str(h): n for h, n in hours},
    }
    logger.info("")
    logger.info("=" * 78)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 78)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
