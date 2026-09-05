#!/usr/bin/env python3
"""#1780 «画像を 1 枚も持たない店» の名前を dev から拾う（読み取り専用）。

## なぜ要るか

ネイティブのエビデンス（画像の無い店がアイコンの受け皿になる）を撮るために、
**確実に画像を持たない店の名前**が要る。

当初は「dev の 62 万店はパイプライン製で image_url を持たないから、
検索結果もほぼ画像なしになる」と考えたが、**実測では外れた**
（run 33957116422 のスクリーンショットでは «ラーメン» の結果 4 件が全部 画像あり）。
店名検索は投稿のある店を上位に返すので、画像を持つ店が並ぶ。

そこで «画像が無いこと» を DB 側で確かめてから、その店名で検索する。

## 画像の出どころは 2 つある。両方無い店を探す

1. `restaurants.image_url` … Google 由来（#1780 で新規保存は停止済み）
2. `dish_media` のサムネイル … API が imageUrls として返す

⚠️ 片方だけ見ると «画像あり» の店を掴む。実際 1 回それで失敗した。

## 使い方

    script_path: scripts/db-checks/find_image_less_restaurant.py
    args: --schema dev --query ラーメン
"""

from __future__ import annotations

import argparse
import logging
import os

LOGGER = logging.getLogger(__name__)

SQL = """
SELECT
  r.name,
  r.google_place_id,
  NULLIF(r.image_url, '') IS NOT NULL AS has_image_url,
  EXISTS (
    SELECT 1 FROM dishes d
    JOIN dish_media dm ON dm.dish_id = d.id
    WHERE d.restaurant_id = r.id
  ) AS has_dish_media
FROM restaurants r
WHERE r.name ILIKE %(pattern)s
  AND NULLIF(r.image_url, '') IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM dishes d
    JOIN dish_media dm ON dm.dish_id = d.id
    WHERE d.restaurant_id = r.id
  )
ORDER BY r.name
LIMIT 20
"""


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument("--query", default="ラーメン")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        LOGGER.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute(SQL, {"pattern": f"%{args.query}%"})
            rows = cur.fetchall()

            LOGGER.info("=" * 70)
            LOGGER.info(
                "# 「%s」を含み、画像を 1 枚も持たない店（schema=%s）",
                args.query,
                args.schema,
            )
            LOGGER.info("=" * 70)
            if not rows:
                LOGGER.info("（該当なし。別の語で探すこと）")
            for name, place_id, has_url, has_media in rows:
                LOGGER.info("  %-40s place_id=%s", name, place_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
